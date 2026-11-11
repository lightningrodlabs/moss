import type { Env } from './env';

const GITHUB_API = 'https://api.github.com';
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const MAX_ERROR_BODY_CHARS = 200;

export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export type CreatedIssue = { number: number; html_url: string; title: string; created_at: string };

type CachedToken = { token: string; expiresAtMs: number };
const tokenCache = new Map<string, CachedToken>();

/** Test-only: forgets cached installation tokens so tests start from a clean slate. */
export function resetInstallationTokenCache(): void {
  tokenCache.clear();
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function textToBase64Url(text: string): string {
  return bytesToBase64Url(new TextEncoder().encode(text));
}

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let n = length; n > 0; n = Math.floor(n / 256)) bytes.unshift(n % 256);
  return [0x80 | bytes.length, ...bytes];
}

function derElement(tag: number, content: Uint8Array): Uint8Array {
  const header = [tag, ...derLength(content.length)];
  const out = new Uint8Array(header.length + content.length);
  out.set(header);
  out.set(content, header.length);
  return out;
}

// rsaEncryption OID 1.2.840.113549.1.1.1 followed by NULL parameters.
const RSA_ALGORITHM_IDENTIFIER = Uint8Array.from([
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
]);

/** Wraps a PKCS#1 RSAPrivateKey in a PKCS#8 PrivateKeyInfo so WebCrypto can import it. */
function wrapPkcs1AsPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = Uint8Array.from([0x02, 0x01, 0x00]);
  const privateKey = derElement(0x04, pkcs1);
  const body = new Uint8Array(version.length + RSA_ALGORITHM_IDENTIFIER.length + privateKey.length);
  body.set(version);
  body.set(RSA_ALGORITHM_IDENTIFIER, version.length);
  body.set(privateKey, version.length + RSA_ALGORITHM_IDENTIFIER.length);
  return derElement(0x30, body);
}

async function importSigningKey(rawPem: string): Promise<CryptoKey> {
  // Secrets pasted through dashboards or env files often carry newlines as the two characters `\n`.
  const pem = rawPem.replace(/\\n/g, '\n');
  const isPkcs1 = pem.includes('BEGIN RSA PRIVATE KEY');
  const base64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    isPkcs1 ? wrapPkcs1AsPkcs8(der) : der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/** Signs the short-lived RS256 JWT that authenticates the worker as the GitHub App. `now` is in milliseconds. */
export async function appJwt(
  appId: string,
  privateKeyPem: string,
  now: () => number = () => Date.now(),
): Promise<string> {
  const nowS = Math.floor(now() / 1000);
  const header = textToBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = textToBase64Url(JSON.stringify({ iss: appId, iat: nowS - 60, exp: nowS + 540 }));
  const key = await importSigningKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

function githubHeaders(authorization: string): Record<string, string> {
  return {
    Authorization: authorization,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'moss-feedback-worker',
  };
}

async function failure(res: Response, what: string): Promise<GitHubError> {
  const text = await res.text().catch(() => '');
  const prefix = text.slice(0, MAX_ERROR_BODY_CHARS);
  return new GitHubError(
    res.status,
    `GitHub ${what} failed with ${res.status}${prefix ? `: ${prefix}` : ''}`,
  );
}

/** Reads a 2xx JSON body and returns it only if the guard accepts its shape; never echoes body content. */
async function parseBody<T>(res: Response, guard: (v: unknown) => v is T): Promise<T> {
  let value: unknown;
  try {
    value = await res.json();
  } catch {
    throw new GitHubError(res.status, 'unexpected response shape');
  }
  if (!guard(value)) throw new GitHubError(res.status, 'unexpected response shape');
  return value;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isTokenResponse(v: unknown): v is { token: string; expires_at: string } {
  return (
    isRecord(v) &&
    typeof v.token === 'string' &&
    v.token !== '' &&
    typeof v.expires_at === 'string' &&
    Number.isFinite(Date.parse(v.expires_at))
  );
}

function isCreatedIssue(v: unknown): v is CreatedIssue {
  return (
    isRecord(v) &&
    typeof v.number === 'number' &&
    Number.isInteger(v.number) &&
    typeof v.html_url === 'string' &&
    typeof v.title === 'string' &&
    typeof v.created_at === 'string'
  );
}

/** Returns an installation access token, reusing a cached one until five minutes before it expires. */
export async function installationToken(
  env: Env,
  fetchImpl: typeof fetch = fetch,
  now: () => number = () => Date.now(),
): Promise<string> {
  const cacheKey = env.GITHUB_INSTALLATION_ID;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs - TOKEN_REFRESH_MARGIN_MS > now()) return cached.token;

  const jwt = await appJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, now);
  const res = await fetchImpl(`${GITHUB_API}/app/installations/${cacheKey}/access_tokens`, {
    method: 'POST',
    headers: githubHeaders(`Bearer ${jwt}`),
  });
  if (!res.ok) throw await failure(res, 'installation token request');
  const data = await parseBody(res, isTokenResponse);
  tokenCache.set(cacheKey, { token: data.token, expiresAtMs: Date.parse(data.expires_at) });
  return data.token;
}

type RepoRequest = { path: string; method: 'GET' | 'POST' | 'PATCH'; json?: unknown };

/** Sends one authenticated request to the configured repository and returns the guarded 2xx body. */
async function repoRequest<T>(
  env: Env,
  req: RepoRequest,
  what: string,
  guard: (v: unknown) => v is T,
  fetchImpl: typeof fetch,
): Promise<T> {
  const token = await installationToken(env, fetchImpl);
  const headers = githubHeaders(`Bearer ${token}`);
  if (req.json !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetchImpl(
    `${GITHUB_API}/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}${req.path}`,
    {
      method: req.method,
      headers,
      ...(req.json !== undefined ? { body: JSON.stringify(req.json) } : {}),
    },
  );
  if (!res.ok) throw await failure(res, what);
  return parseBody(res, guard);
}

export type GitHubComment = {
  id: number;
  body: string;
  created_at: string;
  updated_at: string;
  user: { login: string };
  author_association: string;
};

export type GitHubIssue = {
  number: number;
  state: 'open' | 'closed';
  state_reason: string | null;
  title: string;
  body: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
};

// GitHub reports deleted accounts as `user: null`; they surface under its own placeholder login.
const GHOST_LOGIN = 'ghost';

function isRawComment(v: unknown): v is GitHubComment {
  return (
    isRecord(v) &&
    typeof v.id === 'number' &&
    Number.isInteger(v.id) &&
    typeof v.body === 'string' &&
    typeof v.created_at === 'string' &&
    typeof v.updated_at === 'string' &&
    typeof v.author_association === 'string' &&
    (v.user === null || (isRecord(v.user) && typeof v.user.login === 'string'))
  );
}

function toComment(raw: GitHubComment): GitHubComment {
  return {
    id: raw.id,
    body: raw.body,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    user: { login: raw.user?.login ?? GHOST_LOGIN },
    author_association: raw.author_association,
  };
}

function isGitHubIssue(v: unknown): v is GitHubIssue {
  return (
    isRecord(v) &&
    typeof v.number === 'number' &&
    Number.isInteger(v.number) &&
    (v.state === 'open' || v.state === 'closed') &&
    (v.state_reason === null || typeof v.state_reason === 'string') &&
    typeof v.title === 'string' &&
    (v.body === null || typeof v.body === 'string') &&
    typeof v.created_at === 'string' &&
    typeof v.updated_at === 'string' &&
    typeof v.html_url === 'string'
  );
}

function toIssue(raw: GitHubIssue): GitHubIssue {
  return {
    number: raw.number,
    state: raw.state,
    state_reason: raw.state_reason,
    title: raw.title,
    body: raw.body,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    html_url: raw.html_url,
  };
}

function isRawCommentList(v: unknown): v is GitHubComment[] {
  return Array.isArray(v) && v.every(isRawComment);
}

/** Opens an issue in the configured repository as the installed GitHub App. */
export async function createIssue(
  env: Env,
  p: { title: string; body: string; labels: string[] },
  fetchImpl: typeof fetch = fetch,
): Promise<CreatedIssue> {
  const issue = await repoRequest(
    env,
    { method: 'POST', path: '/issues', json: { title: p.title, body: p.body, labels: p.labels } },
    'issue creation',
    isCreatedIssue,
    fetchImpl,
  );
  return {
    number: issue.number,
    html_url: issue.html_url,
    title: issue.title,
    created_at: issue.created_at,
  };
}

/** Adds a comment to an issue as the installed GitHub App. */
export async function createComment(
  env: Env,
  number: number,
  body: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubComment> {
  const raw = await repoRequest(
    env,
    { method: 'POST', path: `/issues/${number}/comments`, json: { body } },
    'comment creation',
    isRawComment,
    fetchImpl,
  );
  return toComment(raw);
}

/** Closes an issue as completed. */
export async function closeIssue(
  env: Env,
  number: number,
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubIssue> {
  const raw = await repoRequest(
    env,
    {
      method: 'PATCH',
      path: `/issues/${number}`,
      json: { state: 'closed', state_reason: 'completed' },
    },
    'issue close',
    isGitHubIssue,
    fetchImpl,
  );
  return toIssue(raw);
}

/** Reads one issue. */
export async function getIssue(
  env: Env,
  number: number,
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubIssue> {
  const raw = await repoRequest(
    env,
    { method: 'GET', path: `/issues/${number}` },
    'issue read',
    isGitHubIssue,
    fetchImpl,
  );
  return toIssue(raw);
}

/** Reads the first page (up to 100) of an issue's comments, oldest first; later pages are not fetched. */
export async function listIssueComments(
  env: Env,
  number: number,
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubComment[]> {
  const raw = await repoRequest(
    env,
    { method: 'GET', path: `/issues/${number}/comments?per_page=100` },
    'comment list',
    isRawCommentList,
    fetchImpl,
  );
  return raw.map(toComment);
}

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

/** Opens an issue in the configured repository as the installed GitHub App. */
export async function createIssue(
  env: Env,
  p: { title: string; body: string; labels: string[] },
  fetchImpl: typeof fetch = fetch,
): Promise<CreatedIssue> {
  const token = await installationToken(env, fetchImpl);
  const res = await fetchImpl(
    `${GITHUB_API}/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/issues`,
    {
      method: 'POST',
      headers: { ...githubHeaders(`Bearer ${token}`), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: p.title, body: p.body, labels: p.labels }),
    },
  );
  if (!res.ok) throw await failure(res, 'issue creation');
  const issue = await parseBody(res, isCreatedIssue);
  return {
    number: issue.number,
    html_url: issue.html_url,
    title: issue.title,
    created_at: issue.created_at,
  };
}

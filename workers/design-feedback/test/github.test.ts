import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { GitHubError, appJwt, createIssue, installationToken, resetInstallationTokenCache } from '../src/github';

const NOW_MS = 1_800_000_000_000;
const GITHUB_HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'moss-feedback-worker',
};

function b64urlToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function pemBody(pem: string): Uint8Array {
  return Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
}

async function verifyJwt(jwt: string): Promise<boolean> {
  const [h, p, sig] = jwt.split('.');
  const key = await crypto.subtle.importKey(
    'spki',
    pemBody(env.GITHUB_APP_PUBLIC_KEY_SPKI),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
}

type Call = { url: string; method: string; headers: Headers; body: string | null };
type Reply = { status: number; json?: unknown; text?: string };

/** A fetch stand-in that records each call and answers from a queue of canned replies. */
function fakeFetch(replies: Reply[]): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...replies];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    });
    const reply = queue.shift();
    if (!reply) throw new Error('unexpected fetch');
    return new Response(reply.text ?? JSON.stringify(reply.json), { status: reply.status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function expiresIn(ms: number, from: number = NOW_MS): string {
  return new Date(from + ms).toISOString();
}

function expectGithubHeaders(call: Call): void {
  for (const [name, value] of Object.entries(GITHUB_HEADERS)) expect(call.headers.get(name)).toBe(value);
  expect(call.headers.get('authorization')).toMatch(/^Bearer .+/);
}

beforeEach(() => {
  resetInstallationTokenCache();
});

describe('appJwt', () => {
  it('produces a signed RS256 JWT with iss, iat and exp', async () => {
    const jwt = await appJwt('1', env.GITHUB_APP_PRIVATE_KEY, () => NOW_MS);
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);
    expect(JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])))).toEqual({ alg: 'RS256', typ: 'JWT' });
    const nowS = NOW_MS / 1000;
    expect(JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])))).toEqual({
      iss: '1',
      iat: nowS - 60,
      exp: nowS + 540,
    });
    expect(await verifyJwt(jwt)).toBe(true);
  });

  it('accepts a PKCS#1 PEM by wrapping it as PKCS#8', async () => {
    expect(env.GITHUB_APP_PRIVATE_KEY_PKCS1).toContain('BEGIN RSA PRIVATE KEY');
    const jwt = await appJwt('1', env.GITHUB_APP_PRIVATE_KEY_PKCS1, () => NOW_MS);
    expect(await verifyJwt(jwt)).toBe(true);
  });
});

describe('installationToken', () => {
  it('posts once for two calls and caches the token', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 201, json: { token: 'tok-1', expires_at: expiresIn(3_600_000) } }]);
    const now = () => NOW_MS;
    expect(await installationToken(env, fetchImpl, now)).toBe('tok-1');
    expect(await installationToken(env, fetchImpl, now)).toBe('tok-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.github.com/app/installations/2/access_tokens');
    expect(calls[0].method).toBe('POST');
    expectGithubHeaders(calls[0]);
  });

  it('fetches a new token once the cached one is within five minutes of expiry', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 201, json: { token: 'tok-1', expires_at: expiresIn(3_600_000) } },
      { status: 201, json: { token: 'tok-2', expires_at: expiresIn(7_200_000) } },
    ]);
    expect(await installationToken(env, fetchImpl, () => NOW_MS)).toBe('tok-1');
    expect(await installationToken(env, fetchImpl, () => NOW_MS + 3_600_000 - 6 * 60_000)).toBe('tok-1');
    expect(await installationToken(env, fetchImpl, () => NOW_MS + 3_600_000 - 4 * 60_000)).toBe('tok-2');
    expect(calls).toHaveLength(2);
  });

  it('caches per installation id', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 201, json: { token: 'tok-a', expires_at: expiresIn(3_600_000) } },
      { status: 201, json: { token: 'tok-b', expires_at: expiresIn(3_600_000) } },
    ]);
    const now = () => NOW_MS;
    expect(await installationToken(env, fetchImpl, now)).toBe('tok-a');
    expect(await installationToken({ ...env, GITHUB_INSTALLATION_ID: '9' }, fetchImpl, now)).toBe('tok-b');
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.github.com/app/installations/2/access_tokens',
      'https://api.github.com/app/installations/9/access_tokens',
    ]);
  });

  it('rejects a token response without a token', async () => {
    const { fetchImpl } = fakeFetch([{ status: 201, json: { expires_at: expiresIn(3_600_000) } }]);
    const err = await installationToken(env, fetchImpl, () => NOW_MS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).message).toBe('unexpected response shape');
  });

  it('rejects a token response with an unparseable expires_at', async () => {
    const { fetchImpl } = fakeFetch([{ status: 201, json: { token: 't', expires_at: 'soon' } }]);
    const err = await installationToken(env, fetchImpl, () => NOW_MS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
  });

  it('throws GitHubError when the token request fails', async () => {
    const { fetchImpl } = fakeFetch([{ status: 401, json: { message: 'Bad credentials' } }]);
    const err = await installationToken(env, fetchImpl, () => NOW_MS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).status).toBe(401);
  });
});

describe('createIssue', () => {
  const tokenReply = (): Reply => ({
    status: 201,
    json: { token: 'tok-1', expires_at: expiresIn(3_600_000, Date.now()) },
  });

  it('posts the issue with the label and returns the parsed result', async () => {
    const { fetchImpl, calls } = fakeFetch([
      tokenReply(),
      {
        status: 201,
        json: { number: 7, html_url: 'https://github.com/o/r/issues/7', title: 'T', created_at: 'now', extra: 1 },
      },
    ]);
    const issue = await createIssue(env, { title: 'T', body: 'B', labels: ['design-feedback'] }, fetchImpl);
    expect(issue).toEqual({ number: 7, html_url: 'https://github.com/o/r/issues/7', title: 'T', created_at: 'now' });
    expect(calls).toHaveLength(2);
    expectGithubHeaders(calls[0]);
    expectGithubHeaders(calls[1]);
    expect(calls[1].url).toBe('https://api.github.com/repos/o/r/issues');
    expect(calls[1].method).toBe('POST');
    expect(calls[1].headers.get('authorization')).toBe('Bearer tok-1');
    expect(JSON.parse(calls[1].body ?? '')).toEqual({ title: 'T', body: 'B', labels: ['design-feedback'] });
  });

  it('throws GitHubError with the status on a 403', async () => {
    const { fetchImpl } = fakeFetch([tokenReply(), { status: 403, json: { message: 'Forbidden' } }]);
    const err = await createIssue(env, { title: 'T', body: 'B', labels: [] }, fetchImpl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).status).toBe(403);
  });

  it('rejects an issue response whose number is a string', async () => {
    const { fetchImpl } = fakeFetch([
      tokenReply(),
      { status: 201, json: { number: '7', html_url: 'u', title: 'T', created_at: 'now' } },
    ]);
    const err = await createIssue(env, { title: 'T', body: 'B', labels: [] }, fetchImpl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).message).toBe('unexpected response shape');
  });

  it('rejects a non-JSON 201 body with GitHubError', async () => {
    const { fetchImpl } = fakeFetch([tokenReply(), { status: 201, text: '<html>oops</html>' }]);
    const err = await createIssue(env, { title: 'T', body: 'B', labels: [] }, fetchImpl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).status).toBe(201);
  });
});

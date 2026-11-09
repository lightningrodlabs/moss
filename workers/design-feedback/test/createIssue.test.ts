import { SELF, createExecutionContext, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { reporterIdFromPubKey } from '../../../shared/utils/src/feedback/index.ts';
import { resetInstallationTokenCache } from '../src/github';
import { route } from '../src/router';
import { createIssueRoute } from '../src/routes/createIssue';
import { makeTestReporter, type TestReporter } from './sign';

const PATH = '/v1/issues';
const NOW_MS = 1_800_000_000_000;
const enc = new TextEncoder();
// PNG signature followed by a few bytes: enough for the signature check, no real image needed.
const PNG_DATA_URL = `data:image/png;base64,${btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4))}`;

type Call = { url: string; body: string | null };

/** Fake GitHub: answers token requests and issue creation, recording each call. */
function fakeGitHub(issueStatus = 201): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let nextNumber = 100;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : null });
    if (url.endsWith('/access_tokens')) {
      return Response.json(
        { token: 'tok', expires_at: new Date(Date.now() + 3_600_000).toISOString() },
        { status: 201 },
      );
    }
    if (issueStatus !== 201) return new Response('internal secret detail', { status: issueStatus });
    const number = nextNumber++;
    return Response.json(
      { number, html_url: `https://github.com/o/r/issues/${number}`, title: 'T', created_at: 'now' },
      { status: 201 },
    );
  }) as typeof fetch;
  return { fetchImpl, calls };
}

type Payload = { text: string; screenshot: string; mossVersion: string; os: string; githubHandle?: string };

function payload(overrides: Partial<Payload> = {}): Payload {
  return { text: 'The button is misaligned', screenshot: PNG_DATA_URL, mossVersion: '0.16.0', os: 'linux', ...overrides };
}

let ipCounter = 0;

async function signedRequest(
  reporter: TestReporter,
  body: string,
  ip: string,
  opts: { tamper?: boolean } = {},
): Promise<Request> {
  const headers = await reporter.sign({
    method: 'POST',
    path: PATH,
    body: enc.encode(body),
    nowSeconds: NOW_MS / 1000,
  });
  return new Request(`https://w${PATH}`, {
    method: 'POST',
    headers: { ...headers, 'CF-Connecting-IP': ip },
    body: opts.tamper ? `${body} ` : body,
  });
}

async function call(req: Request, fetchImpl: typeof fetch): Promise<Response> {
  const routes = [createIssueRoute({ fetchImpl, nowMs: () => NOW_MS })];
  return route(req, routes, env, createExecutionContext());
}

async function r2Keys(): Promise<string[]> {
  return (await env.FEEDBACK_BUCKET.list()).objects.map((o) => o.key);
}

async function count(table: 'issues' | 'reporters'): Promise<number> {
  const row = await env.FEEDBACK_DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

async function expectNothingStored(): Promise<void> {
  expect(await r2Keys()).toEqual([]);
  expect(await count('issues')).toBe(0);
  expect(await count('reporters')).toBe(0);
}

async function expectError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ error: code, message: expect.any(String) });
}

beforeEach(async () => {
  resetInstallationTokenCache();
  ipCounter++;
  await env.FEEDBACK_DB.batch([
    env.FEEDBACK_DB.prepare('DELETE FROM issues'),
    env.FEEDBACK_DB.prepare('DELETE FROM reporters'),
  ]);
  const keys = await r2Keys();
  if (keys.length > 0) await env.FEEDBACK_BUCKET.delete(keys);
});

describe('POST /v1/issues', () => {
  it('creates an issue, stores the screenshot, and records reporter and issue in D1', async () => {
    const reporter = await makeTestReporter();
    const reporterId = await reporterIdFromPubKey(reporter.pubKey);
    const github = fakeGitHub();
    const req = await signedRequest(reporter, JSON.stringify(payload({ githubHandle: 'octo-cat' })), `10.0.0.${ipCounter}`);

    const res = await call(req, github.fetchImpl);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ issueNumber: 100, issueUrl: 'https://github.com/o/r/issues/100' });

    const keys = await r2Keys();
    expect(keys).toHaveLength(1);

    const issue = await env.FEEDBACK_DB.prepare('SELECT * FROM issues WHERE number = ?').bind(100).first();
    expect(issue).toMatchObject({
      number: 100,
      reporter_id: reporterId,
      state: 'open',
      state_reason: null,
      title: '[Design Feedback] The button is misaligned',
      created_at: NOW_MS / 1000,
      updated_at: NOW_MS / 1000,
      created_via: 'worker',
    });
    const rep = await env.FEEDBACK_DB.prepare('SELECT * FROM reporters WHERE reporter_id = ?')
      .bind(reporterId)
      .first<{ pubkey: ArrayBuffer; created_at: number }>();
    expect(rep).not.toBeNull();
    expect(new Uint8Array(rep!.pubkey)).toEqual(reporter.pubKey);
    expect(rep!.created_at).toBe(NOW_MS / 1000);

    const issueCall = github.calls.find((c) => c.url.endsWith('/repos/o/r/issues'));
    const sent = JSON.parse(issueCall?.body ?? '{}') as { title: string; body: string; labels: string[] };
    expect(sent.labels).toEqual(['design-feedback']);
    expect(sent.body).toContain(`<!-- moss-feedback reporter=${reporterId} -->`);
    expect(sent.body).toContain('- GitHub: @octo-cat');
    expect(sent.body).toContain(`https://r2.test/${keys[0]}`);
  });

  it('unsigned request is 401 and nothing is stored', async () => {
    const reporter = await makeTestReporter();
    const github = fakeGitHub();
    const req = await signedRequest(reporter, JSON.stringify(payload()), `10.0.1.${ipCounter}`, { tamper: true });

    await expectError(await call(req, github.fetchImpl), 401, 'invalid_signature');
    expect(github.calls).toHaveLength(0);
    await expectNothingStored();
  });

  it('a request with no signature headers through the worker is 400 and nothing is stored', async () => {
    const res = await SELF.fetch(`https://w${PATH}`, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': `10.0.2.${ipCounter}` },
      body: JSON.stringify(payload()),
    });
    await expectError(res, 400, 'bad_request');
    await expectNothingStored();
  });

  it('whitespace text is 400 bad_request and nothing is stored', async () => {
    const reporter = await makeTestReporter();
    const github = fakeGitHub();
    const req = await signedRequest(reporter, JSON.stringify(payload({ text: '   \n\t ' })), `10.0.3.${ipCounter}`);

    await expectError(await call(req, github.fetchImpl), 400, 'bad_request');
    expect(github.calls).toHaveLength(0);
    await expectNothingStored();
  });

  it('a body that is not JSON is 400 bad_request', async () => {
    const reporter = await makeTestReporter();
    const github = fakeGitHub();
    const req = await signedRequest(reporter, '{not json', `10.0.4.${ipCounter}`);

    await expectError(await call(req, github.fetchImpl), 400, 'bad_request');
    await expectNothingStored();
  });

  it('a mislabelled screenshot is 400 screenshot_invalid and nothing is stored', async () => {
    const reporter = await makeTestReporter();
    const github = fakeGitHub();
    const req = await signedRequest(
      reporter,
      JSON.stringify(payload({ screenshot: `data:image/png;base64,${btoa('GIF89a-not-a-png')}` })),
      `10.0.5.${ipCounter}`,
    );

    await expectError(await call(req, github.fetchImpl), 400, 'screenshot_invalid');
    expect(github.calls).toHaveLength(0);
    await expectNothingStored();
  });

  it('eleventh issue in an hour is 429 with Retry-After', async () => {
    const reporter = await makeTestReporter();
    const github = fakeGitHub();
    const ip = `10.0.6.${ipCounter}`;
    for (let i = 0; i < 10; i++) {
      const res = await call(await signedRequest(reporter, JSON.stringify(payload()), ip), github.fetchImpl);
      expect(res.status).toBe(201);
    }
    const res = await call(await signedRequest(reporter, JSON.stringify(payload()), ip), github.fetchImpl);
    await expectError(res, 429, 'rate_limited');
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await r2Keys()).toHaveLength(10);
    expect(await count('issues')).toBe(10);
  });

  it('thirty-first request from one IP in a minute is 429 with Retry-After before authentication', async () => {
    const github = fakeGitHub();
    const ip = `10.0.7.${ipCounter}`;
    const bad = () => new Request(`https://w${PATH}`, { method: 'POST', headers: { 'CF-Connecting-IP': ip }, body: '{}' });
    for (let i = 0; i < 30; i++) expect((await call(bad(), github.fetchImpl)).status).toBe(400);
    const res = await call(bad(), github.fetchImpl);
    await expectError(res, 429, 'rate_limited');
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('GitHub 500 yields 502 github_error and the screenshot is removed', async () => {
    const reporter = await makeTestReporter();
    const github = fakeGitHub(500);
    const req = await signedRequest(reporter, JSON.stringify(payload()), `10.0.8.${ipCounter}`);

    const res = await call(req, github.fetchImpl);

    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('internal secret detail');
    expect(JSON.parse(text)).toEqual({ error: 'github_error', message: expect.any(String) });
    expect(github.calls.some((c) => c.url.endsWith('/repos/o/r/issues'))).toBe(true);
    await expectNothingStored();
  });
});

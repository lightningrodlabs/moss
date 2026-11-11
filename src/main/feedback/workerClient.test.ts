import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  FEEDBACK_HEADERS,
  verifySignedRequest,
  type CreateIssueRequest,
  type ReplyRequest,
  type SyncRequest,
} from '@theweave/utils';
import { reporterKeyFromSeed } from './reporterKey';
import { FeedbackWorkerClient } from './workerClient';

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const NOW_MS = 1_800_000_000_000;

const req: CreateIssueRequest = {
  text: 'The sidebar flickers',
  screenshot: 'data:image/png;base64,AAAA',
  mossVersion: '0.16.0',
  os: 'linux',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function makeClient(fetchFn: typeof fetch, extra: { timeoutMs?: number } = {}) {
  const key = reporterKeyFromSeed(new Uint8Array(32).fill(1));
  const client = new FeedbackWorkerClient('https://worker.example/', key, {
    fetch: fetchFn,
    now: () => NOW_MS,
    randomNonce: () => new Uint8Array(16).fill(7),
    ...extra,
  });
  return { client, key };
}

describe('FeedbackWorkerClient.createIssue', () => {
  it('posts a signed request whose headers verify', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(201, { issueNumber: 5, issueUrl: 'u' }));
    const { client, key } = await makeClient(fetchFn as unknown as typeof fetch);
    await client.createIssue(req);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://worker.example/v1/issues');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    const body = new TextEncoder().encode(init.body as string);
    expect(JSON.parse(init.body as string)).toEqual(req);

    const publicKey = createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, key.publicKey]),
      format: 'der',
      type: 'spki',
    });
    const result = await verifySignedRequest({
      method: 'POST',
      path: '/v1/issues',
      body,
      headers: (name) => headers.get(name),
      nowSeconds: NOW_MS / 1000,
      verify: async (_pk, message, signature) => verify(null, message, publicKey, signature),
    });
    expect(result.ok).toBe(true);
    expect(headers.get(FEEDBACK_HEADERS.timestamp)).toBe(String(NOW_MS / 1000));
  });

  it('passes an abort signal', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(201, { issueNumber: 5, issueUrl: 'u' }));
    const { client } = await makeClient(fetchFn as unknown as typeof fetch);
    await client.createIssue(req);
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns ok with the parsed response on 200', async () => {
    const value = { issueNumber: 12, issueUrl: 'https://github.com/o/r/issues/12' };
    const { client } = await makeClient((async () => jsonResponse(200, value)) as typeof fetch);
    expect(await client.createIssue(req)).toEqual({ ok: true, value });
  });

  it('treats a 2xx body that is not JSON or the wrong shape as server_error', async () => {
    const notJson = (async () => new Response('<html>', { status: 200 })) as typeof fetch;
    const wrongShape = (async () => jsonResponse(200, { issueNumber: 'x' })) as typeof fetch;
    for (const f of [notJson, wrongShape]) {
      const { client } = await makeClient(f);
      const r = await client.createIssue(req);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('server_error');
    }
  });

  it('maps a network error to unreachable', async () => {
    const { client } = await makeClient((async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch);
    const r = await client.createIssue(req);
    expect(r).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('maps a timeout to unreachable', async () => {
    const slow = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const { client } = await makeClient(slow, { timeoutMs: 20 });
    const r = await client.createIssue(req);
    expect(r).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('maps 401 stale_timestamp to stale_timestamp', async () => {
    const { client } = await makeClient((async () =>
      jsonResponse(401, { error: 'stale_timestamp', message: 'clock' })) as typeof fetch);
    expect(await client.createIssue(req)).toMatchObject({
      ok: false,
      reason: 'stale_timestamp',
      status: 401,
    });
  });

  it('maps other 401 and 400 to rejected', async () => {
    const { client } = await makeClient((async () =>
      jsonResponse(401, { error: 'invalid_signature', message: 'bad' })) as typeof fetch);
    expect(await client.createIssue(req)).toMatchObject({
      ok: false,
      reason: 'rejected',
      status: 401,
    });
    const b = await makeClient((async () =>
      jsonResponse(400, { error: 'bad_request', message: 'nope' })) as typeof fetch);
    expect(await b.client.createIssue(req)).toMatchObject({
      ok: false,
      reason: 'rejected',
      status: 400,
      message: 'nope',
    });
  });

  it('maps 413 to rejected', async () => {
    const { client } = await makeClient((async () =>
      jsonResponse(413, { error: 'bad_request', message: 'too large' })) as typeof fetch);
    expect(await client.createIssue(req)).toMatchObject({
      ok: false,
      reason: 'rejected',
      status: 413,
    });
  });

  it('maps 429 to rate_limited and 500 to server_error', async () => {
    const a = await makeClient((async () =>
      jsonResponse(429, { error: 'rate_limited', message: 'slow down' })) as typeof fetch);
    expect(await a.client.createIssue(req)).toMatchObject({
      ok: false,
      reason: 'rate_limited',
      status: 429,
    });
    const b = await makeClient((async () => new Response('boom', { status: 500 })) as typeof fetch);
    expect(await b.client.createIssue(req)).toMatchObject({
      ok: false,
      reason: 'server_error',
      status: 500,
    });
  });
});

const comment = {
  id: 1,
  authorLogin: 'bot',
  authorAssociation: 'NONE',
  body: 'hi',
  postedForReporter: false,
  deleted: false,
  createdAt: 10,
  updatedAt: 11,
};
const syncValue = {
  issues: [{ number: 3, state: 'open', title: 'T', updatedAt: 12, comments: [comment] }],
};

async function expectSignedPath(
  call: (c: FeedbackWorkerClient) => Promise<unknown>,
  path: string,
  responseBody: unknown,
  expectedBody: unknown,
) {
  const fetchFn = vi.fn(async () => jsonResponse(200, responseBody));
  const { client, key } = await makeClient(fetchFn as unknown as typeof fetch);
  await call(client);
  const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(`https://worker.example${path}`);
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body as string)).toEqual(expectedBody);
  const headers = new Headers(init.headers);
  const publicKey = createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, key.publicKey]),
    format: 'der',
    type: 'spki',
  });
  const result = await verifySignedRequest({
    method: 'POST',
    path,
    body: new TextEncoder().encode(init.body as string),
    headers: (name) => headers.get(name),
    nowSeconds: NOW_MS / 1000,
    verify: async (_pk, message, signature) => verify(null, message, publicKey, signature),
  });
  expect(result.ok).toBe(true);
}

describe('FeedbackWorkerClient thread calls', () => {
  it('sync signs /v1/sync and returns the response', async () => {
    const syncReq: SyncRequest = { issues: [{ number: 3, since: 1 }] };
    await expectSignedPath((c) => c.sync(syncReq), '/v1/sync', syncValue, syncReq);
    const { client } = await makeClient((async () => jsonResponse(200, syncValue)) as typeof fetch);
    expect(await client.sync(syncReq)).toEqual({ ok: true, value: syncValue });
  });

  it('reply signs the comments path', async () => {
    const replyReq: ReplyRequest = { text: 'thanks' };
    await expectSignedPath(
      (c) => c.reply(7, replyReq),
      '/v1/issues/7/comments',
      { commentId: 4, createdAt: 9 },
      replyReq,
    );
  });

  it('resolve signs the resolve path with an empty JSON body', async () => {
    await expectSignedPath(
      (c) => c.resolve(7),
      '/v1/issues/7/resolve',
      { state: 'closed', closedAt: 9 },
      {},
    );
  });

  it('rejects a non-positive-integer issue number without sending', async () => {
    const fetchFn = vi.fn();
    const { client } = await makeClient(fetchFn as unknown as typeof fetch);
    for (const n of [0, -1, 1.5, NaN]) {
      await expect(client.resolve(n)).rejects.toThrow(TypeError);
      await expect(client.reply(n, { text: 'x' })).rejects.toThrow(TypeError);
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps 409 to conflict and 404 to rejected', async () => {
    const a = await makeClient((async () =>
      jsonResponse(409, { error: 'conflict', message: 'closed' })) as typeof fetch);
    expect(await a.client.resolve(2)).toMatchObject({ ok: false, reason: 'conflict', status: 409 });
    const b = await makeClient((async () =>
      jsonResponse(404, { error: 'not_found', message: 'no' })) as typeof fetch);
    expect(await b.client.resolve(2)).toMatchObject({ ok: false, reason: 'rejected', status: 404 });
  });

  it('treats malformed sync, reply and resolve responses as server_error', async () => {
    const badSync = { issues: [{ ...syncValue.issues[0], state: 'weird' }] };
    const badComment = {
      issues: [{ ...syncValue.issues[0], comments: [{ ...comment, deleted: 'no' }] }],
    };
    const replyReq: ReplyRequest = { text: 'x' };
    const syncReq: SyncRequest = { issues: [] };
    const cases: Array<[unknown, (c: FeedbackWorkerClient) => Promise<{ ok: boolean }>]> = [
      [badSync, (c) => c.sync(syncReq)],
      [badComment, (c) => c.sync(syncReq)],
      [{}, (c) => c.sync(syncReq)],
      [{ commentId: 'x', createdAt: 1 }, (c) => c.reply(1, replyReq)],
      [{ state: 'open', closedAt: 1 }, (c) => c.resolve(1)],
      [{ state: 'closed' }, (c) => c.resolve(1)],
    ];
    for (const [body, call] of cases) {
      const { client } = await makeClient((async () => jsonResponse(200, body)) as typeof fetch);
      const r = (await call(client)) as { ok: boolean; reason?: string };
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('server_error');
    }
  });
});

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { reporterIdFromPubKey } from '../../../shared/utils/src/feedback/index.ts';
import { authenticate, type Authed } from '../src/auth';
import { makeTestReporter } from './sign';

const PATH = '/v1/submit';
const NOW = 1_800_000_000;
const enc = new TextEncoder();

async function signedRequest(opts: {
  body?: string;
  signedBody?: string;
  at?: number;
  nonce?: Uint8Array;
  drop?: string;
}): Promise<{ req: Request; pubKey: Uint8Array }> {
  const reporter = await makeTestReporter();
  const body = opts.body ?? '{"a":1}';
  const headers = await reporter.sign({
    method: 'POST',
    path: PATH,
    body: enc.encode(opts.signedBody ?? body),
    nowSeconds: opts.at ?? NOW,
    nonce: opts.nonce,
  });
  if (opts.drop) delete (headers as Record<string, string>)[opts.drop];
  return {
    req: new Request(`https://w${PATH}`, { method: 'POST', headers, body }),
    pubKey: reporter.pubKey,
  };
}

const run = (req: Request) => authenticate(req, env, () => NOW * 1000);

async function expectError(result: Authed | Response, status: number, code: string) {
  expect(result).toBeInstanceOf(Response);
  const res = result as Response;
  expect(res.status).toBe(status);
  expect(((await res.json()) as { error: string }).error).toBe(code);
}

describe('authenticate', () => {
  it('accepts a fresh signed request and returns the reporter id', async () => {
    const { req, pubKey } = await signedRequest({});
    const result = await run(req);
    expect(result).not.toBeInstanceOf(Response);
    const authed = result as Authed;
    expect(authed.reporterId).toBe(await reporterIdFromPubKey(pubKey));
    expect(new TextDecoder().decode(authed.body)).toBe('{"a":1}');
  });

  it('rejects a 301 second old timestamp with 401 stale_timestamp', async () => {
    const { req } = await signedRequest({ at: NOW - 301 });
    await expectError(await run(req), 401, 'stale_timestamp');
  });

  it('rejects a replayed nonce with 401 replayed_nonce', async () => {
    const { req } = await signedRequest({});
    const first = await run(req.clone());
    expect(first).not.toBeInstanceOf(Response);
    await expectError(await run(req.clone()), 401, 'replayed_nonce');
  });

  it('rejects a tampered body with 401 invalid_signature', async () => {
    const { req } = await signedRequest({ body: '{"a":2}', signedBody: '{"a":1}' });
    await expectError(await run(req), 401, 'invalid_signature');
  });

  it('rejects missing headers with 400 bad_request', async () => {
    const { req } = await signedRequest({ drop: 'X-Moss-Signature' });
    await expectError(await run(req), 400, 'bad_request');
  });

  it('rejects an over-long nonce with 400 bad_request', async () => {
    const { req } = await signedRequest({ nonce: new Uint8Array(60).fill(7) });
    await expectError(await run(req), 400, 'bad_request');
  });
});

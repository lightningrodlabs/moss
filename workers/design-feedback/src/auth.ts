import {
  FEEDBACK_LIMITS,
  reporterIdFromPubKey,
  verifySignedRequest,
} from '../../../shared/utils/src/feedback/index.ts';
import type { Env } from './env';
import { jsonError } from './router';

export type Authed = { pubKey: Uint8Array; reporterId: string; body: Uint8Array };

// The nonce becomes part of a KV key, so its size and alphabet are bounded before use.
const NONCE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export async function verifyEd25519(
  pubKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    pubKey as BufferSource,
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    { name: 'Ed25519' },
    key,
    signature as BufferSource,
    message as BufferSource,
  );
}

/** Verifies the reporter signature and rejects any nonce already seen within its TTL. */
export async function authenticate(
  req: Request,
  env: Env,
  now: () => number = () => Date.now(),
): Promise<Authed | Response> {
  const body = new Uint8Array(await req.arrayBuffer());
  const result = await verifySignedRequest({
    method: req.method,
    path: new URL(req.url).pathname,
    body,
    headers: (name) => req.headers.get(name),
    nowSeconds: Math.floor(now() / 1000),
    verify: verifyEd25519,
  });
  if (!result.ok) {
    switch (result.error) {
      case 'stale_timestamp':
        return jsonError(401, 'stale_timestamp', 'Request timestamp is outside the allowed window');
      case 'invalid_signature':
        return jsonError(401, 'invalid_signature', 'Request signature is invalid');
      case 'bad_request':
        return jsonError(400, 'bad_request', 'Missing or malformed authentication headers');
    }
  }
  if (!NONCE_PATTERN.test(result.nonce)) {
    return jsonError(400, 'bad_request', 'Malformed nonce');
  }
  const nonceKey = `nonce:${result.nonce}`;
  if ((await env.FEEDBACK_KV.get(nonceKey)) !== null) {
    return jsonError(401, 'replayed_nonce', 'Nonce has already been used');
  }
  await env.FEEDBACK_KV.put(nonceKey, '1', { expirationTtl: FEEDBACK_LIMITS.nonceTtlSeconds });
  return { pubKey: result.pubKey, reporterId: await reporterIdFromPubKey(result.pubKey), body };
}

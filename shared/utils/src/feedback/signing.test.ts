import { describe, it, expect } from 'vitest';
import {
  generateKeyPairSync,
  createPublicKey,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from 'node:crypto';
import {
  FEEDBACK_HEADERS,
  base64UrlDecode,
  base64UrlEncode,
  buildSignedHeaders,
  canonicalRequestString,
  isTimestampFresh,
  reporterIdFromPubKey,
  verifySignedRequest,
} from './signing.js';

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function makeKey(): { pubKey: Uint8Array; priv: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return { pubKey: new Uint8Array(der.subarray(der.length - 32)), priv: privateKey };
}

const verify = async (pubKey: Uint8Array, message: Uint8Array, signature: Uint8Array) =>
  nodeVerify(
    null,
    message,
    createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, pubKey]), format: 'der', type: 'spki' }),
    signature,
  );

const body = new TextEncoder().encode('{"text":"hi"}');
const nonce = new Uint8Array(16).fill(9);

async function signed(nowSeconds = 1700000000) {
  const { pubKey, priv } = makeKey();
  const headers = await buildSignedHeaders({
    method: 'post',
    path: '/v1/issues',
    body,
    pubKey,
    nonce,
    nowSeconds,
    sign: async (m) => new Uint8Array(nodeSign(null, m, priv)),
  });
  return { pubKey, headers };
}

describe('signing helpers', () => {
  it('canonical string matches the spec layout', () => {
    const s = canonicalRequestString({
      method: 'post',
      path: '/v1/issues',
      timestamp: 1700000000,
      nonce: 'abc',
      bodySha256: new Uint8Array(32),
    });
    expect(s).toBe(`moss-feedback-v1\nPOST\n/v1/issues\n1700000000\nabc\n${base64UrlEncode(new Uint8Array(32))}`);
  });
  it('base64url round trips without padding', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + n) & 0xff);
      const enc = base64UrlEncode(bytes);
      expect(enc).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(base64UrlDecode(enc)).toEqual(bytes);
    }
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
  });
  it('timestamp window is 300 seconds inclusive', () => {
    expect(isTimestampFresh(1000, 1300)).toBe(true);
    expect(isTimestampFresh(1000, 1301)).toBe(false);
    expect(isTimestampFresh(1301, 1000)).toBe(false);
  });
  it('reporter id is 12 chars of base64url sha256', async () => {
    const id = await reporterIdFromPubKey(new Uint8Array(32).fill(7));
    expect(id).toHaveLength(12);
    expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });
});

describe('build and verify signed requests', () => {
  it('round trips with node ed25519', async () => {
    const { pubKey, headers } = await signed();
    const res = await verifySignedRequest({
      method: 'POST',
      path: '/v1/issues',
      body,
      headers: (n) => headers[n as keyof typeof headers] ?? null,
      nowSeconds: 1700000010,
      verify,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.pubKey).toEqual(pubKey);
      expect(res.nonce).toBe(base64UrlEncode(nonce));
    }
  });
  it('a tampered body fails verification', async () => {
    const { headers } = await signed();
    const res = await verifySignedRequest({
      method: 'POST',
      path: '/v1/issues',
      body: new TextEncoder().encode('{"text":"evil"}'),
      headers: (n) => headers[n as keyof typeof headers] ?? null,
      nowSeconds: 1700000010,
      verify,
    });
    expect(res).toEqual({ ok: false, error: 'invalid_signature' });
  });
  it('a timestamp 301s old is stale_timestamp before signature check', async () => {
    const { headers } = await signed();
    let verifyCalled = false;
    const res = await verifySignedRequest({
      method: 'POST',
      path: '/v1/issues',
      body,
      headers: (n) => headers[n as keyof typeof headers] ?? null,
      nowSeconds: 1700000301,
      verify: async () => {
        verifyCalled = true;
        return true;
      },
    });
    expect(res).toEqual({ ok: false, error: 'stale_timestamp' });
    expect(verifyCalled).toBe(false);
  });
  it('a missing header is bad_request', async () => {
    const { headers } = await signed();
    const res = await verifySignedRequest({
      method: 'POST',
      path: '/v1/issues',
      body,
      headers: (n) => (n === FEEDBACK_HEADERS.nonce ? null : headers[n as keyof typeof headers] ?? null),
      nowSeconds: 1700000010,
      verify,
    });
    expect(res).toEqual({ ok: false, error: 'bad_request' });
  });
  it('a non-32-byte pubkey is bad_request', async () => {
    const { headers } = await signed();
    const res = await verifySignedRequest({
      method: 'POST',
      path: '/v1/issues',
      body,
      headers: (n) =>
        n === FEEDBACK_HEADERS.reporter ? base64UrlEncode(new Uint8Array(31)) : headers[n as keyof typeof headers] ?? null,
      nowSeconds: 1700000010,
      verify,
    });
    expect(res).toEqual({ ok: false, error: 'bad_request' });
  });
});

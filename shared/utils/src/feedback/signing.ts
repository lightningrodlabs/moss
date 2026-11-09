import { FEEDBACK_LIMITS } from './protocol.js';

export const FEEDBACK_SIGNING_DOMAIN = 'moss-feedback-v1';

export const FEEDBACK_HEADERS = {
  reporter: 'X-Moss-Reporter',
  timestamp: 'X-Moss-Timestamp',
  nonce: 'X-Moss-Nonce',
  signature: 'X-Moss-Signature',
} as const;

const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Unpadded base64url, implemented by hand so it runs unchanged in Node and Workers. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += B64URL_ALPHABET[(n >> 18) & 63] + B64URL_ALPHABET[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64URL_ALPHABET[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64URL_ALPHABET[n & 63];
  }
  return out;
}

/** Throws on characters outside the base64url alphabet or an impossible length. */
export function base64UrlDecode(s: string): Uint8Array {
  if (s.length % 4 === 1) throw new Error('Invalid base64url length');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    let n = 0;
    const chunk = Math.min(4, s.length - i);
    for (let j = 0; j < 4; j++) {
      let v = 0;
      if (j < chunk) {
        v = B64URL_ALPHABET.indexOf(s[i + j]);
        if (v < 0) throw new Error('Invalid base64url character');
      }
      n = (n << 6) | v;
    }
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

/** The exact string both sides sign and verify, binding method, path, time, nonce and body. */
export function canonicalRequestString(p: {
  method: string;
  path: string;
  timestamp: number;
  nonce: string;
  bodySha256: Uint8Array;
}): string {
  return [
    FEEDBACK_SIGNING_DOMAIN,
    p.method.toUpperCase(),
    p.path,
    String(p.timestamp),
    p.nonce,
    base64UrlEncode(p.bodySha256),
  ].join('\n');
}

export function isTimestampFresh(
  timestamp: number,
  nowSeconds: number,
  windowSeconds: number = FEEDBACK_LIMITS.timestampWindowSeconds,
): boolean {
  return Math.abs(nowSeconds - timestamp) <= windowSeconds;
}

/** Short stable pseudonymous reporter id used as the rate-limit key. */
export async function reporterIdFromPubKey(pubKey: Uint8Array): Promise<string> {
  return base64UrlEncode(await sha256(pubKey)).slice(0, 12);
}

export type SignedHeaders = Record<(typeof FEEDBACK_HEADERS)[keyof typeof FEEDBACK_HEADERS], string>;

export async function buildSignedHeaders(p: {
  method: string;
  path: string;
  body: Uint8Array;
  pubKey: Uint8Array;
  nonce: Uint8Array;
  nowSeconds: number;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
}): Promise<SignedHeaders> {
  const nonce = base64UrlEncode(p.nonce);
  const canonical = canonicalRequestString({
    method: p.method,
    path: p.path,
    timestamp: p.nowSeconds,
    nonce,
    bodySha256: await sha256(p.body),
  });
  const signature = await p.sign(new TextEncoder().encode(canonical));
  return {
    [FEEDBACK_HEADERS.reporter]: base64UrlEncode(p.pubKey),
    [FEEDBACK_HEADERS.timestamp]: String(p.nowSeconds),
    [FEEDBACK_HEADERS.nonce]: nonce,
    [FEEDBACK_HEADERS.signature]: base64UrlEncode(signature),
  };
}

/**
 * Checks headers, freshness and signature. Nonce replay is not checked here;
 * the caller owns nonce storage and uses the returned nonce for it.
 */
export async function verifySignedRequest(p: {
  method: string;
  path: string;
  body: Uint8Array;
  headers: (name: string) => string | null;
  nowSeconds: number;
  verify: (pubKey: Uint8Array, message: Uint8Array, signature: Uint8Array) => Promise<boolean>;
}): Promise<
  | { ok: true; pubKey: Uint8Array; nonce: string }
  | { ok: false; error: 'invalid_signature' | 'stale_timestamp' | 'bad_request' }
> {
  const reporter = p.headers(FEEDBACK_HEADERS.reporter);
  const timestampRaw = p.headers(FEEDBACK_HEADERS.timestamp);
  const nonce = p.headers(FEEDBACK_HEADERS.nonce);
  const signatureRaw = p.headers(FEEDBACK_HEADERS.signature);
  if (!reporter || !timestampRaw || !nonce || !signatureRaw) {
    return { ok: false, error: 'bad_request' };
  }
  let pubKey: Uint8Array;
  let signature: Uint8Array;
  try {
    pubKey = base64UrlDecode(reporter);
    signature = base64UrlDecode(signatureRaw);
  } catch {
    return { ok: false, error: 'bad_request' };
  }
  if (pubKey.length !== 32) return { ok: false, error: 'bad_request' };
  if (!/^\d{1,15}$/.test(timestampRaw)) return { ok: false, error: 'bad_request' };
  const timestamp = Number(timestampRaw);
  if (!isTimestampFresh(timestamp, p.nowSeconds)) return { ok: false, error: 'stale_timestamp' };

  const canonical = canonicalRequestString({
    method: p.method,
    path: p.path,
    timestamp,
    nonce,
    bodySha256: await sha256(p.body),
  });
  let valid = false;
  try {
    valid = await p.verify(pubKey, new TextEncoder().encode(canonical), signature);
  } catch {
    valid = false;
  }
  return valid ? { ok: true, pubKey, nonce } : { ok: false, error: 'invalid_signature' };
}

import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { reporterIdFromPubKey } from '@theweave/utils';
import { reporterKeyFromSeed } from './reporterKey';

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

describe('reporterKeyFromSeed', () => {
  it('is deterministic for the same seed', async () => {
    const a = reporterKeyFromSeed(new Uint8Array(32).fill(1));
    const b = reporterKeyFromSeed(new Uint8Array(32).fill(1));
    expect(a.publicKey).toEqual(b.publicKey);
    expect(a.reporterId).toBe(b.reporterId);
  });

  it('differs for a different seed', () => {
    const a = reporterKeyFromSeed(new Uint8Array(32).fill(1));
    const b = reporterKeyFromSeed(new Uint8Array(32).fill(2));
    expect(a.publicKey).not.toEqual(b.publicKey);
  });

  it('exports a 32 byte public key', () => {
    expect(reporterKeyFromSeed(new Uint8Array(32).fill(3)).publicKey.length).toBe(32);
  });

  it('rejects a seed that is not 32 bytes', () => {
    expect(() => reporterKeyFromSeed(new Uint8Array(31))).toThrow(/32 bytes/);
  });

  it('signatures verify against the exported public key', async () => {
    const key = reporterKeyFromSeed(new Uint8Array(32).fill(4));
    const message = new TextEncoder().encode('hello feedback');
    const sig = await key.sign(message);
    const publicKey = createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, key.publicKey]),
      format: 'der',
      type: 'spki',
    });
    expect(verify(null, message, publicKey, sig)).toBe(true);
    expect(verify(null, new TextEncoder().encode('other'), publicKey, sig)).toBe(false);
  });

  it('reporterId equals reporterIdFromPubKey(publicKey)', async () => {
    const key = reporterKeyFromSeed(new Uint8Array(32).fill(5));
    expect(key.reporterId).toBe(await reporterIdFromPubKey(key.publicKey));
  });

  // Frozen known-answer vector. Existing reporters' ids depend on this mapping,
  // so these values must never change.
  it('maps the fixed seed 0..31 to a frozen public key and reporter id', async () => {
    const key = reporterKeyFromSeed(Uint8Array.from({ length: 32 }, (_, i) => i));
    expect(Buffer.from(key.publicKey).toString('base64url')).toBe(
      'A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg',
    );
    expect(key.reporterId).toBe('Vkdap1RjR0wC');
  });
});

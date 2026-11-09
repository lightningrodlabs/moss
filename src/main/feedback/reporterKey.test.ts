import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { reporterIdFromPubKey } from '@theweave/utils';
import { deriveReporterKey, type AgentSigner } from './reporterKey';

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

describe('deriveReporterKey', () => {
  it('is deterministic for the same agent signature', async () => {
    const signer: AgentSigner = async () => new Uint8Array(64).fill(1);
    const a = await deriveReporterKey(signer);
    const b = await deriveReporterKey(signer);
    expect(a.publicKey).toEqual(b.publicKey);
    expect(a.reporterId).toBe(b.reporterId);
  });

  it('differs for a different agent signature', async () => {
    const a = await deriveReporterKey(async () => new Uint8Array(64).fill(1));
    const b = await deriveReporterKey(async () => new Uint8Array(64).fill(2));
    expect(a.publicKey).not.toEqual(b.publicKey);
    expect(a.reporterId).not.toBe(b.reporterId);
  });

  it('asks the agent signer for exactly the derivation message', async () => {
    const seen: Uint8Array[] = [];
    await deriveReporterKey(async (m) => {
      seen.push(m);
      return new Uint8Array(64);
    });
    expect(seen).toHaveLength(1);
    expect(Buffer.from(seen[0]).toString('utf8')).toBe('moss-feedback-key-v1');
  });

  it('exports a 32 byte public key', async () => {
    const key = await deriveReporterKey(async () => new Uint8Array(64).fill(3));
    expect(key.publicKey.length).toBe(32);
  });

  it('signatures verify against the exported public key', async () => {
    const key = await deriveReporterKey(async () => new Uint8Array(64).fill(4));
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
    const key = await deriveReporterKey(async () => new Uint8Array(64).fill(5));
    expect(key.reporterId).toBe(await reporterIdFromPubKey(key.publicKey));
  });
});

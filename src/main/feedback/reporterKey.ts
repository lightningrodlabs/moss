import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto';

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export type ReporterKey = {
  publicKey: Uint8Array;
  reporterId: string;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
};

/**
 * Builds the pseudonymous Ed25519 feedback key from a 32-byte seed. The
 * reporter id follows the shared `reporterIdFromPubKey` formula: the first
 * 12 base64url characters of sha256(publicKey).
 */
export function reporterKeyFromSeed(seed: Uint8Array): ReporterKey {
  if (seed.length !== 32) {
    throw new Error(`Reporter key seed must be 32 bytes, got ${seed.length}`);
  }
  const privateKey: KeyObject = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const publicKey = new Uint8Array(spki.subarray(spki.length - 32));
  return {
    publicKey,
    reporterId: createHash('sha256').update(publicKey).digest('base64url').slice(0, 12),
    sign: async (message) => new Uint8Array(sign(null, message, privateKey)),
  };
}

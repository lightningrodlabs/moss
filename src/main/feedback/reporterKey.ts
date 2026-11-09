import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto';
import { reporterIdFromPubKey } from '@theweave/utils';

export const REPORTER_KEY_DERIVATION_MESSAGE = 'moss-feedback-key-v1';

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export type AgentSigner = (message: Uint8Array) => Promise<Uint8Array>;

export type ReporterKey = {
  publicKey: Uint8Array;
  reporterId: string;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
};

/**
 * Derives a stable pseudonymous Ed25519 key for feedback from the agent key:
 * the agent signs a fixed message and the hash of that signature seeds the key.
 */
export async function deriveReporterKey(signWithAgentKey: AgentSigner): Promise<ReporterKey> {
  const agentSignature = await signWithAgentKey(
    new TextEncoder().encode(REPORTER_KEY_DERIVATION_MESSAGE)
  );
  const seed = createHash('sha256').update(agentSignature).digest();
  const privateKey: KeyObject = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const publicKey = new Uint8Array(spki.subarray(spki.length - 32));
  return {
    publicKey,
    reporterId: await reporterIdFromPubKey(publicKey),
    sign: async (message) => new Uint8Array(sign(null, message, privateKey)),
  };
}

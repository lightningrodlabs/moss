import { randomBytes } from 'node:crypto';
import fs from 'node:fs';

const SEED_LENGTH = 32;

/** Byte-level view of Electron `safeStorage`, injectable for tests. */
export type SeedCipher = {
  isEncryptionAvailable(): boolean;
  encrypt(plain: Buffer): Buffer;
  decrypt(cipher: Buffer): Buffer;
};

type SeedEnvelope = { v: 1; enc: 'safeStorage' | 'plain'; data: string };

function parseEnvelope(text: string): SeedEnvelope {
  const parsed: unknown = JSON.parse(text);
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'v' in parsed &&
    parsed.v === 1 &&
    'enc' in parsed &&
    (parsed.enc === 'safeStorage' || parsed.enc === 'plain') &&
    'data' in parsed &&
    typeof parsed.data === 'string'
  ) {
    return { v: 1, enc: parsed.enc, data: parsed.data };
  }
  throw new Error('Unknown reporter seed file format');
}

/**
 * Returns this profile's random reporter seed, creating it on first use.
 *
 * The seed is encrypted with the OS keychain via `safeStorage` when that is
 * available. On Linux without a keyring it is not. The lair keystore in the
 * same profile is the more valuable secret, so the seed is then stored in
 * plaintext with owner-only permissions rather than disabling feedback.
 */
export function loadOrCreateReporterSeed(
  filePath: string,
  cipher: SeedCipher,
  random: (n: number) => Uint8Array = randomBytes,
): Uint8Array {
  if (fs.existsSync(filePath)) {
    const envelope = parseEnvelope(fs.readFileSync(filePath, 'utf8'));
    const stored = Buffer.from(envelope.data, 'base64');
    const seed = envelope.enc === 'safeStorage' ? cipher.decrypt(stored) : stored;
    if (seed.length !== SEED_LENGTH) {
      throw new Error(`Reporter seed must be ${SEED_LENGTH} bytes, got ${seed.length}`);
    }
    return new Uint8Array(seed);
  }
  const seed = Buffer.from(random(SEED_LENGTH));
  const encrypted = cipher.isEncryptionAvailable();
  const envelope: SeedEnvelope = {
    v: 1,
    enc: encrypted ? 'safeStorage' : 'plain',
    data: (encrypted ? cipher.encrypt(seed) : seed).toString('base64'),
  };
  fs.writeFileSync(filePath, JSON.stringify(envelope), { mode: 0o600, flag: 'wx' });
  return new Uint8Array(seed);
}

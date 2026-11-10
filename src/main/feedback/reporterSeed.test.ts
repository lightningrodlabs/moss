import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateReporterSeed, type SeedCipher } from './reporterSeed';

/** Reversible stand-in for safeStorage: XOR with 0x5a. */
function fakeCipher(available: boolean): SeedCipher {
  const xor = (b: Buffer): Buffer => Buffer.from(b.map((x) => x ^ 0x5a));
  return { isEncryptionAvailable: () => available, encrypt: xor, decrypt: xor };
}

const fixedRandom = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => i + 1);

describe('loadOrCreateReporterSeed', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-seed-'));
    file = path.join(dir, 'reporter-seed.json');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('creates a seed once and reloads the same seed', () => {
    const cipher = fakeCipher(true);
    const first = loadOrCreateReporterSeed(file, cipher, fixedRandom);
    expect(first).toEqual(fixedRandom(32));
    const second = loadOrCreateReporterSeed(file, cipher, () => {
      throw new Error('must not generate again');
    });
    expect(second).toEqual(first);
  });

  it('stores the seed encrypted when encryption is available', () => {
    loadOrCreateReporterSeed(file, fakeCipher(true), fixedRandom);
    const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(envelope.v).toBe(1);
    expect(envelope.enc).toBe('safeStorage');
    expect(Buffer.from(envelope.data, 'base64')).not.toEqual(Buffer.from(fixedRandom(32)));
  });

  it('stores the seed in plaintext when encryption is unavailable', () => {
    loadOrCreateReporterSeed(file, fakeCipher(false), fixedRandom);
    const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(envelope).toEqual({
      v: 1,
      enc: 'plain',
      data: Buffer.from(fixedRandom(32)).toString('base64'),
    });
    expect(loadOrCreateReporterSeed(file, fakeCipher(false))).toEqual(fixedRandom(32));
  });

  it('throws when the stored seed is not 32 bytes', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ v: 1, enc: 'plain', data: Buffer.alloc(31).toString('base64') }),
    );
    expect(() => loadOrCreateReporterSeed(file, fakeCipher(false))).toThrow(/32 bytes/);
  });

  it('throws on an unknown envelope format', () => {
    fs.writeFileSync(file, JSON.stringify({ v: 2, enc: 'plain', data: '' }));
    expect(() => loadOrCreateReporterSeed(file, fakeCipher(false))).toThrow(/format/);
  });

  it.skipIf(process.platform === 'win32')('writes the file with owner-only permissions', () => {
    loadOrCreateReporterSeed(file, fakeCipher(true), fixedRandom);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
});

import { describe, it, expect } from 'vitest';
import { duplicateNames, nameFromPublicKey } from './naming.js';

const KEY_A = new Uint8Array(65).fill(1);
const KEY_B = new Uint8Array(65).fill(2);

describe('nameFromPublicKey', () => {
  it('gives the same name for the same key every time', async () => {
    expect(await nameFromPublicKey(KEY_A)).toBe(await nameFromPublicKey(KEY_A));
  });

  it('gives different names for different keys', async () => {
    expect(await nameFromPublicKey(KEY_A)).not.toBe(await nameFromPublicKey(KEY_B));
  });

  it('produces two capitalised words', async () => {
    expect(await nameFromPublicKey(KEY_A)).toMatch(/^[A-Z][a-z]{2,7} [A-Z][a-z]{2,7}$/);
  });

  it('changes when a single byte of the key changes', async () => {
    const nudged = new Uint8Array(KEY_A);
    nudged[64] = 9;
    expect(await nameFromPublicKey(nudged)).not.toBe(await nameFromPublicKey(KEY_A));
  });
});

describe('duplicateNames', () => {
  it('is empty when every name is distinct', () => {
    expect(duplicateNames(['Purple Monkey', 'Amber Otter']).size).toBe(0);
  });

  it('reports a name that two beacons derived', () => {
    const dupes = duplicateNames(['Purple Monkey', 'Amber Otter', 'Purple Monkey']);
    expect([...dupes]).toEqual(['Purple Monkey']);
  });
});

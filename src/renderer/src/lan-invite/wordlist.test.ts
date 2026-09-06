import { describe, it, expect } from 'vitest';
import { WORDLIST } from './wordlist.js';

describe('WORDLIST', () => {
  it('has exactly 2048 entries, so each word consumes exactly 11 bits', () => {
    expect(WORDLIST.length).toBe(2048);
  });

  it('holds only lowercase ascii words of a speakable length', () => {
    for (const word of WORDLIST) {
      expect(word).toMatch(/^[a-z]{3,8}$/);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(WORDLIST).size).toBe(WORDLIST.length);
  });

  it('distinguishes every word by its first four letters, so a misheard ending is recoverable', () => {
    const prefixes = new Set(WORDLIST.map((w) => w.slice(0, 4)));
    expect(prefixes.size).toBe(WORDLIST.length);
  });
});

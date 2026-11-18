import { describe, expect, it } from 'vitest';
import { COPYRIGHT_START_YEAR, copyrightYears, parseNotices } from './about-content';

describe('copyrightYears', () => {
  it('spans from the first year to the build year', () => {
    expect(copyrightYears(2021, 2026)).toBe('2021–2026');
  });

  it('shows a single year when they match', () => {
    expect(copyrightYears(2026, 2026)).toBe('2026');
  });

  it('starts in the year the README copyright starts', () => {
    expect(COPYRIGHT_START_YEAR).toBe(2021);
  });
});

describe('parseNotices', () => {
  it('accepts the generated notices file', () => {
    const notices = parseNotices({
      binaries: [{ name: 'holochain', license: 'CAL-1.0', url: 'https://x', copyright: 'c' }],
      packages: [{ name: 'lit', version: '3.0.0', license: 'BSD-3-Clause', text: 't' }],
    });
    expect(notices?.packages[0].name).toBe('lit');
    expect(notices?.binaries[0].name).toBe('holochain');
  });

  it('rejects anything else', () => {
    expect(parseNotices(undefined)).toBeUndefined();
    expect(parseNotices({ packages: 'x' })).toBeUndefined();
    expect(parseNotices({ binaries: [], packages: [{ name: 1 }] })).toBeUndefined();
  });
});

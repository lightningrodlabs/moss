import { describe, expect, it } from 'vitest';

import type { AsrModelListEntry } from '@theweave/moss-types';

import { formatModelSize, isEnglishOnly, modelRowState } from './model-row-state.js';

function entry(overrides: Partial<AsrModelListEntry> = {}): AsrModelListEntry {
  return {
    id: 'small',
    sizeBytes: 487_601_967,
    languages: ['en', 'de'],
    latencyTier: 'ok',
    installed: false,
    bundled: false,
    active: false,
    ...overrides,
  };
}

describe('modelRowState', () => {
  it('offers Download for a model that is absent', () => {
    expect(modelRowState(entry(), undefined)).toEqual({ kind: 'download' });
  });

  it('offers Resume, and a way to discard the partial file, when one exists', () => {
    expect(modelRowState(entry({ partialBytes: 1234 }), undefined)).toEqual({
      kind: 'resume',
      partialBytes: 1234,
      deletable: true,
    });
  });

  it('shows progress while downloading, rounding percent down', () => {
    expect(modelRowState(entry(), { id: 'small', bytes: 999, total: 1000 })).toEqual({
      kind: 'downloading',
      percent: 99,
    });
  });

  it('treats a zero total as 0 percent rather than NaN', () => {
    expect(modelRowState(entry(), { id: 'small', bytes: 0, total: 0 })).toEqual({ kind: 'downloading', percent: 0 });
  });

  it('marks installed and active rows, hiding delete for bundled-only copies', () => {
    expect(modelRowState(entry({ installed: true }), undefined)).toEqual({ kind: 'installed', deletable: true });
    expect(modelRowState(entry({ installed: true, bundled: true }), undefined)).toEqual({
      kind: 'installed',
      deletable: false,
    });
    expect(modelRowState(entry({ installed: true, active: true }), undefined)).toEqual({
      kind: 'active',
      deletable: true,
    });
  });
});

describe('formatModelSize', () => {
  it('uses MB below a gigabyte and one-decimal GB above', () => {
    expect(formatModelSize(147_964_211)).toBe('148 MB');
    expect(formatModelSize(1_533_763_059)).toBe('1.5 GB');
    expect(formatModelSize(3_095_033_483)).toBe('3.1 GB');
  });
});

describe('isEnglishOnly', () => {
  it('is true only for the single-code English list', () => {
    expect(isEnglishOnly(['en'])).toBe(true);
    expect(isEnglishOnly(['en', 'de'])).toBe(false);
    expect(isEnglishOnly([])).toBe(false);
  });
});

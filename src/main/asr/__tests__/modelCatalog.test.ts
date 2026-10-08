import { describe, expect, it } from 'vitest';

import {
  ASR_MODEL_CATALOG,
  WHISPER_MULTILINGUAL_CODES,
  catalogEntryById,
  catalogEntryForPath,
} from '../modelCatalog';

describe('ASR_MODEL_CATALOG', () => {
  it('lists the ten ggml whisper models in size order', () => {
    expect(ASR_MODEL_CATALOG.map((e) => e.id)).toEqual([
      'tiny',
      'tiny.en',
      'base',
      'base.en',
      'small',
      'small.en',
      'medium',
      'medium.en',
      'large-v3-turbo',
      'large-v3',
    ]);
  });

  it('has a well-formed entry for every model', () => {
    for (const e of ASR_MODEL_CATALOG) {
      expect(e.filename).toBe(`ggml-${e.id}.bin`);
      expect(e.url).toBe(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${e.filename}`);
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(e.sizeBytes).toBeGreaterThan(50_000_000);
      expect(e.startTimeoutMs).toBeGreaterThanOrEqual(60_000);
      expect(['fast', 'ok', 'slow']).toContain(e.latencyTier);
    }
  });

  it('marks .en models English-only and the rest multilingual', () => {
    expect(catalogEntryById('base.en')!.languages).toEqual(['en']);
    expect(catalogEntryById('base')!.languages).toEqual([...WHISPER_MULTILINGUAL_CODES]);
  });

  it('gives bigger models a longer start budget', () => {
    expect(catalogEntryById('large-v3')!.startTimeoutMs).toBeGreaterThan(
      catalogEntryById('tiny')!.startTimeoutMs,
    );
  });

  it('looks entries up by id and by file path', () => {
    expect(catalogEntryById('nope')).toBeUndefined();
    expect(catalogEntryForPath('/some/dir/ggml-small.en.bin')!.id).toBe('small.en');
    expect(catalogEntryForPath('/some/dir/ggml-custom-q5.bin')).toBeUndefined();
  });

  it('keeps the bundled base.en checksum in sync with scripts/fetch-asr-model.mjs', () => {
    expect(catalogEntryById('base.en')!.sha256).toBe(
      'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
    );
  });
});

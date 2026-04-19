import { describe, expect, it } from 'vitest';

import { WHISPER_MULTILINGUAL_CODES, computeAsrCapabilities } from '../capabilities';

describe('computeAsrCapabilities', () => {
  it('marks unavailable when no model is configured', () => {
    const caps = computeAsrCapabilities({ modelPath: null });
    expect(caps.asr.available).toBe(false);
    expect(caps.asr.languages).toEqual([]);
    expect(caps.asr.model).toBe('');
    expect(caps.asr.streaming).toBe(false);
    expect(caps.asr.latencyTier).toBe('ok');
  });

  it('extracts a single-language code from ggml-base.en.bin', () => {
    const caps = computeAsrCapabilities({
      modelPath: '/tmp/whatever/ggml-base.en.bin',
    });
    expect(caps.asr.available).toBe(true);
    expect(caps.asr.model).toBe('base.en');
    expect(caps.asr.languages).toEqual(['en']);
    expect(caps.asr.streaming).toBe(false);
  });

  it('returns the multilingual code set for a plain ggml-small.bin', () => {
    const caps = computeAsrCapabilities({ modelPath: 'ggml-small.bin' });
    expect(caps.asr.model).toBe('small');
    expect(caps.asr.languages).toEqual([...WHISPER_MULTILINGUAL_CODES]);
  });

  it('treats non-2-letter suffixes as part of a multilingual model name', () => {
    // e.g. ggml-large-v3.bin or a quantized variant
    const caps = computeAsrCapabilities({ modelPath: 'ggml-large-v3.bin' });
    expect(caps.asr.model).toBe('large-v3');
    expect(caps.asr.languages).toEqual([...WHISPER_MULTILINGUAL_CODES]);
  });

  it('honors the latencyTier override', () => {
    const caps = computeAsrCapabilities({
      modelPath: 'ggml-base.en.bin',
      latencyTier: 'fast',
    });
    expect(caps.asr.latencyTier).toBe('fast');
  });

  it('accepts an absolute path with directories', () => {
    const caps = computeAsrCapabilities({
      modelPath: '/home/user/.cache/moss/models/ggml-medium.de.bin',
    });
    expect(caps.asr.model).toBe('medium.de');
    expect(caps.asr.languages).toEqual(['de']);
  });
});

import { afterEach, describe, expect, it } from 'vitest';

import {
  _resetAsrServiceForTests,
  defaultModelPath,
  getAsrBroker,
  initAsrService,
  isAsrServiceInitialized,
  shutdownAsrService,
} from '../asrService';

afterEach(async () => {
  await shutdownAsrService();
  _resetAsrServiceForTests();
});

describe('asrService singleton', () => {
  it('is uninitialized before initAsrService()', () => {
    expect(isAsrServiceInitialized()).toBe(false);
    expect(() => getAsrBroker()).toThrow(/not initialized/);
  });

  it('initAsrService() constructs the broker (dev mode resolves nix-shell fallback)', () => {
    const broker = initAsrService({
      binariesDir: '/tmp/nonexistent',
      whisperServerVersion: '1.8.4',
      isPackaged: false,
      modelPath: '/dev/null/some-model.bin',
    });
    expect(isAsrServiceInitialized()).toBe(true);
    expect(getAsrBroker()).toBe(broker);
    expect(broker.openSessionCount).toBe(0);
  });

  it('initAsrService() is idempotent on the second call', () => {
    const a = initAsrService({
      binariesDir: '/tmp/nonexistent',
      whisperServerVersion: '1.8.4',
      isPackaged: false,
      modelPath: '/dev/null/some-model.bin',
    });
    const b = initAsrService({
      binariesDir: '/tmp/nonexistent',
      whisperServerVersion: '1.8.4',
      isPackaged: false,
      modelPath: '/dev/null/different.bin',
    });
    expect(a).toBe(b);
  });

  it('throws WhisperCommandResolveError when packaged with no resolvable binary', () => {
    expect(() =>
      initAsrService({
        binariesDir: '/tmp/nonexistent',
        whisperServerVersion: '1.8.4',
        isPackaged: true,
        modelPath: '/dev/null/some-model.bin',
      }),
    ).toThrow(/Cannot locate whisper-server/);
    expect(isAsrServiceInitialized()).toBe(false);
  });

  it('shutdownAsrService() resets the singleton and is idempotent', async () => {
    initAsrService({
      binariesDir: '/tmp/nonexistent',
      whisperServerVersion: '1.8.4',
      isPackaged: false,
      modelPath: '/dev/null/some-model.bin',
    });
    expect(isAsrServiceInitialized()).toBe(true);
    await shutdownAsrService();
    expect(isAsrServiceInitialized()).toBe(false);
    await shutdownAsrService(); // no throw
  });
});

describe('defaultModelPath', () => {
  it('uses $MOSS_ASR_MODEL when set', () => {
    const orig = process.env.MOSS_ASR_MODEL;
    process.env.MOSS_ASR_MODEL = '/custom/path.bin';
    try {
      expect(defaultModelPath('/repo')).toBe('/custom/path.bin');
    } finally {
      if (orig === undefined) delete process.env.MOSS_ASR_MODEL;
      else process.env.MOSS_ASR_MODEL = orig;
    }
  });

  it('falls back to the spike model when env is unset', () => {
    const orig = process.env.MOSS_ASR_MODEL;
    delete process.env.MOSS_ASR_MODEL;
    try {
      expect(defaultModelPath('/repo')).toBe('/repo/spikes/asr-m0/models/ggml-base.en.bin');
    } finally {
      if (orig !== undefined) process.env.MOSS_ASR_MODEL = orig;
    }
  });
});

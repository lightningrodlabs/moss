import { afterEach, describe, expect, it } from 'vitest';

import {
  _resetAsrServiceForTests,
  getAsrBroker,
  getAsrCapabilities,
  getAsrModelPath,
  initAsrService,
  isAsrServiceInitialized,
  setAsrModelPath,
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
    expect(broker).not.toBeNull();
    expect(getAsrBroker()).toBe(broker);
    expect(broker!.openSessionCount).toBe(0);
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

  it('returns null when packaged with no resolvable binary; getAsrBroker() throws with the resolver message', () => {
    const result = initAsrService({
      binariesDir: '/tmp/nonexistent',
      whisperServerVersion: '1.8.4',
      isPackaged: true,
      modelPath: '/dev/null/some-model.bin',
    });
    expect(result).toBeNull();
    expect(isAsrServiceInitialized()).toBe(true);
    expect(() => getAsrBroker()).toThrow(/Cannot locate whisper-server/);
    expect(getAsrCapabilities().asr.available).toBe(false);
  });

  it('reports unavailable and refuses a broker when no model file is configured', () => {
    const result = initAsrService({
      binariesDir: '/tmp/nonexistent',
      whisperServerVersion: '1.8.4',
      isPackaged: false,
      modelPath: null,
    });
    expect(result).toBeNull();
    expect(getAsrCapabilities().asr.available).toBe(false);
    expect(() => getAsrBroker()).toThrow(/model/i);
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

describe('setAsrModelPath', () => {
  it('updates capabilities and the broker config when a broker exists', async () => {
    const broker = initAsrService({
      binariesDir: '/tmp/nonexistent',
      whisperServerVersion: '1.8.4',
      isPackaged: false,
      modelPath: '/models/ggml-base.en.bin',
    })!;
    expect(getAsrCapabilities().asr.model).toBe('base.en');

    await setAsrModelPath('/models/ggml-small.bin', 120_000);

    expect(getAsrModelPath()).toBe('/models/ggml-small.bin');
    expect(getAsrCapabilities().asr.model).toBe('small');
    expect(getAsrCapabilities().asr.languages).toContain('de');
    expect(broker.serverConfig.modelPath).toBe('/models/ggml-small.bin');
    expect(broker.serverConfig.startTimeoutMs).toBeGreaterThanOrEqual(120_000);
  });

  it('creates the broker when init had no model and a model is set later', async () => {
    expect(
      initAsrService({
        binariesDir: '/tmp/nonexistent',
        whisperServerVersion: '1.8.4',
        isPackaged: false,
        modelPath: null,
      }),
    ).toBeNull();
    expect(getAsrCapabilities().asr.available).toBe(false);
    expect(() => getAsrBroker()).toThrow(/No ASR model/);

    await setAsrModelPath('/models/ggml-tiny.bin');

    expect(getAsrCapabilities().asr.available).toBe(true);
    expect(getAsrBroker().serverConfig.modelPath).toBe('/models/ggml-tiny.bin');
  });

  it('reports unavailable again when the model is cleared', async () => {
    initAsrService({
      binariesDir: '/tmp/nonexistent',
      whisperServerVersion: '1.8.4',
      isPackaged: false,
      modelPath: '/models/ggml-base.en.bin',
    });
    await setAsrModelPath(null);
    expect(getAsrCapabilities().asr.available).toBe(false);
    expect(() => getAsrBroker()).toThrow(/No ASR model/);
  });

  it('still records the path when whisper-server cannot be resolved', async () => {
    initAsrService({
      binariesDir: '/tmp/nonexistent',
      whisperServerVersion: '1.8.4',
      isPackaged: true,
      modelPath: '/models/ggml-base.en.bin',
    });
    await setAsrModelPath('/models/ggml-small.bin');
    expect(getAsrModelPath()).toBe('/models/ggml-small.bin');
    expect(getAsrCapabilities().asr.available).toBe(false);
    expect(() => getAsrBroker()).toThrow(/Cannot locate whisper-server/);
  });
});

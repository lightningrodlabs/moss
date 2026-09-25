import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  _resetAsrServiceForTests,
  defaultModelPath,
  getAsrBroker,
  getAsrCapabilities,
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

  it('returns null when neither a bundled nor a spike model file exists', () => {
    const orig = process.env.MOSS_ASR_MODEL;
    delete process.env.MOSS_ASR_MODEL;
    try {
      expect(defaultModelPath('/nonexistent-repo', '/tmp/nonexistent-resources')).toBeNull();
      expect(defaultModelPath('/nonexistent-repo')).toBeNull();
    } finally {
      if (orig !== undefined) process.env.MOSS_ASR_MODEL = orig;
    }
  });

  it('prefers the bundled model, then the spike model, when the file exists', () => {
    const orig = process.env.MOSS_ASR_MODEL;
    delete process.env.MOSS_ASR_MODEL;
    const root = mkdtempSync(path.join(tmpdir(), 'asr-model-'));
    try {
      const spike = path.join(root, 'repo/spikes/asr-m0/models/ggml-base.en.bin');
      mkdirSync(path.dirname(spike), { recursive: true });
      writeFileSync(spike, '');
      expect(defaultModelPath(path.join(root, 'repo'), path.join(root, 'resources'))).toBe(spike);

      const bundled = path.join(root, 'resources/models/ggml-base.en.bin');
      mkdirSync(path.dirname(bundled), { recursive: true });
      writeFileSync(bundled, '');
      expect(defaultModelPath(path.join(root, 'repo'), path.join(root, 'resources'))).toBe(bundled);
    } finally {
      rmSync(root, { recursive: true, force: true });
      if (orig !== undefined) process.env.MOSS_ASR_MODEL = orig;
    }
  });
});

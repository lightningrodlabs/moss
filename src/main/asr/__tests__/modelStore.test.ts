// src/main/asr/__tests__/modelStore.test.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AsrModelStore } from '../modelStore';

const dirs: string[] = [];

function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'asr-store-'));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeStore(opts: { bundled?: boolean; spike?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  const root = tmp();
  const modelsDir = path.join(root, 'models');
  const configDir = path.join(root, 'config');
  const bundledModelsDir = path.join(root, 'resources', 'models');
  const spikeModelsDir = path.join(root, 'spike');
  mkdirSync(modelsDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  if (opts.bundled) {
    mkdirSync(bundledModelsDir, { recursive: true });
    writeFileSync(path.join(bundledModelsDir, 'ggml-base.en.bin'), 'bundled');
  }
  if (opts.spike) {
    mkdirSync(spikeModelsDir, { recursive: true });
    writeFileSync(path.join(spikeModelsDir, 'ggml-base.en.bin'), 'spike');
  }
  const store = new AsrModelStore({
    modelsDir,
    configDir,
    bundledModelsDir,
    spikeModelsDir,
    env: opts.env ?? {},
  });
  return { store, modelsDir, configDir, bundledModelsDir, spikeModelsDir };
}

describe('AsrModelStore selection file', () => {
  it('reads undefined when nothing was saved, round-trips a choice, and clears it', () => {
    const { store, configDir } = makeStore();
    expect(store.readSelection()).toBeUndefined();
    store.writeSelection('small');
    expect(store.readSelection()).toBe('small');
    expect(JSON.parse(readFileSync(path.join(configDir, 'asr-model.json'), 'utf-8'))).toEqual({
      modelId: 'small',
    });
    store.writeSelection(undefined);
    expect(store.readSelection()).toBeUndefined();
    expect(existsSync(path.join(configDir, 'asr-model.json'))).toBe(false);
  });

  it('reads undefined from a damaged file', () => {
    const { store, configDir } = makeStore();
    writeFileSync(path.join(configDir, 'asr-model.json'), 'not json');
    expect(store.readSelection()).toBeUndefined();
  });
});

describe('AsrModelStore resolution', () => {
  it('returns null when no model exists anywhere', () => {
    const { store } = makeStore();
    expect(store.resolveActiveModelPath()).toBeNull();
    expect(store.activeModelId()).toBeUndefined();
  });

  it('prefers $MOSS_ASR_MODEL over everything', () => {
    const { store } = makeStore({ bundled: true, env: { MOSS_ASR_MODEL: '/custom/ggml-x.bin' } });
    store.writeSelection('base.en');
    expect(store.resolveActiveModelPath()).toBe('/custom/ggml-x.bin');
    expect(store.activeModelId()).toBeUndefined();
  });

  it('uses the saved choice when that model is installed', () => {
    const { store, modelsDir } = makeStore({ bundled: true });
    writeFileSync(path.join(modelsDir, 'ggml-small.bin'), 'x');
    store.writeSelection('small');
    expect(store.resolveActiveModelPath()).toBe(path.join(modelsDir, 'ggml-small.bin'));
    expect(store.activeModelId()).toBe('small');
  });

  it('falls back to bundled when the saved choice is not installed', () => {
    const { store, bundledModelsDir } = makeStore({ bundled: true });
    store.writeSelection('small');
    expect(store.resolveActiveModelPath()).toBe(path.join(bundledModelsDir, 'ggml-base.en.bin'));
    expect(store.activeModelId()).toBe('base.en');
  });

  it('falls back to the spike dir when nothing is bundled', () => {
    const { store, spikeModelsDir } = makeStore({ spike: true });
    expect(store.resolveActiveModelPath()).toBe(path.join(spikeModelsDir, 'ggml-base.en.bin'));
  });

  it('resolves a saved choice of base.en to the bundled copy when it was never downloaded', () => {
    const { store, bundledModelsDir } = makeStore({ bundled: true });
    store.writeSelection('base.en');
    expect(store.resolveActiveModelPath()).toBe(path.join(bundledModelsDir, 'ggml-base.en.bin'));
  });
});

describe('AsrModelStore.listModels', () => {
  it('lists every catalog entry with installed, bundled, active and partial state', () => {
    const { store, modelsDir } = makeStore({ bundled: true });
    writeFileSync(path.join(modelsDir, 'ggml-small.bin'), 'x');
    writeFileSync(path.join(modelsDir, 'ggml-medium.bin.part'), '12345');
    store.writeSelection('small');

    const list = store.listModels();
    expect(list).toHaveLength(10);
    const byId = Object.fromEntries(list.map((e) => [e.id, e]));

    expect(byId['base.en']).toMatchObject({ installed: true, bundled: true, active: false });
    expect(byId['small']).toMatchObject({ installed: true, bundled: false, active: true });
    expect(byId['medium']).toMatchObject({
      installed: false,
      bundled: false,
      active: false,
      partialBytes: 5,
    });
    expect(byId['tiny']).toMatchObject({ installed: false, bundled: false, active: false });
    expect(byId['tiny'].partialBytes).toBeUndefined();
    expect(byId['tiny'].languages).toEqual(expect.arrayContaining(['en', 'de']));
    expect(byId['tiny'].sizeBytes).toBe(77_691_713);
  });
});

describe('AsrModelStore.deleteModel', () => {
  it('removes the file and any .part, and clears the selection when it was active', () => {
    const { store, modelsDir } = makeStore({ bundled: true });
    writeFileSync(path.join(modelsDir, 'ggml-small.bin'), 'x');
    writeFileSync(path.join(modelsDir, 'ggml-small.bin.part'), 'y');
    store.writeSelection('small');
    store.deleteModel('small');
    expect(existsSync(path.join(modelsDir, 'ggml-small.bin'))).toBe(false);
    expect(existsSync(path.join(modelsDir, 'ggml-small.bin.part'))).toBe(false);
    expect(store.readSelection()).toBeUndefined();
    expect(store.activeModelId()).toBe('base.en');
  });

  it('refuses to delete a bundled-only model and an unknown id', () => {
    const { store } = makeStore({ bundled: true });
    expect(() => store.deleteModel('base.en')).toThrow(/bundled/);
    expect(() => store.deleteModel('nope')).toThrow(/unknown model/);
  });

  it('removes a downloaded copy of the bundled model but keeps the bundled one listed', () => {
    const { store, modelsDir } = makeStore({ bundled: true });
    writeFileSync(path.join(modelsDir, 'ggml-base.en.bin'), 'x');
    store.deleteModel('base.en');
    expect(existsSync(path.join(modelsDir, 'ggml-base.en.bin'))).toBe(false);
    expect(store.listModels().find((e) => e.id === 'base.en')).toMatchObject({
      installed: true,
      bundled: true,
    });
  });
});

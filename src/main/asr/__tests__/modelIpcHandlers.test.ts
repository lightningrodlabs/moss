import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type AsrModelCatalogEntry, catalogEntryById } from '../modelCatalog';
import { ModelDownloader } from '../modelDownloader';
import {
  type AsrModelIpcContext,
  asrModelCancelDownload,
  asrModelDelete,
  asrModelDownload,
  asrModelDownloadAnnounced,
  asrModelSelect,
  asrModelsList,
} from '../modelIpcHandlers';
import { AsrModelStore } from '../modelStore';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeCtx(opts: { fetch?: typeof fetch } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'asr-ipc-'));
  dirs.push(root);
  const modelsDir = path.join(root, 'models');
  const bundledModelsDir = path.join(root, 'bundled');
  mkdirSync(modelsDir);
  mkdirSync(bundledModelsDir);
  writeFileSync(path.join(bundledModelsDir, 'ggml-base.en.bin'), 'bundled');
  const store = new AsrModelStore({ modelsDir, configDir: path.join(root, 'config'), bundledModelsDir, env: {} });
  const downloader = new ModelDownloader({
    modelsDir,
    fetch: opts.fetch ?? ((async () => new Response(null, { status: 503 })) as typeof fetch),
    onProgress: () => undefined,
  });
  const applyModelPath = vi.fn(async (_p: string | null, _t?: number) => undefined);
  const ctx: AsrModelIpcContext = { store, downloader, applyModelPath };
  return { ctx, store, modelsDir, applyModelPath };
}

describe('model IPC handlers', () => {
  it('lists the catalog with install state', () => {
    const { ctx } = makeCtx();
    const list = asrModelsList(ctx);
    expect(list.find((e) => e.id === 'base.en')).toMatchObject({ installed: true, bundled: true, active: true });
  });

  it('select writes the choice and applies the resolved path with the catalog start budget', async () => {
    const { ctx, store, modelsDir, applyModelPath } = makeCtx();
    writeFileSync(path.join(modelsDir, 'ggml-small.bin'), 'x');

    await asrModelSelect(ctx, { id: 'small' });

    expect(store.readSelection()).toBe('small');
    expect(applyModelPath).toHaveBeenCalledWith(path.join(modelsDir, 'ggml-small.bin'), 60_000 + 60_000);
  });

  it('select rejects a model that is not installed and leaves the choice alone', async () => {
    const { ctx, store, applyModelPath } = makeCtx();
    await expect(asrModelSelect(ctx, { id: 'small' })).rejects.toThrow(/not installed/);
    expect(store.readSelection()).toBeUndefined();
    expect(applyModelPath).not.toHaveBeenCalled();
  });

  it('delete of the active model falls back to bundled and re-applies', async () => {
    const { ctx, store, modelsDir, applyModelPath } = makeCtx();
    writeFileSync(path.join(modelsDir, 'ggml-small.bin'), 'x');
    store.writeSelection('small');

    await asrModelDelete(ctx, { id: 'small' });

    expect(store.readSelection()).toBeUndefined();
    expect(applyModelPath).toHaveBeenCalledWith(expect.stringMatching(/bundled[/\\]ggml-base\.en\.bin$/), 120_000);
  });

  it('delete of an inactive model does not touch the broker', async () => {
    const { ctx, modelsDir, applyModelPath } = makeCtx();
    writeFileSync(path.join(modelsDir, 'ggml-small.bin'), 'x');
    await asrModelDelete(ctx, { id: 'small' });
    expect(applyModelPath).not.toHaveBeenCalled();
  });

  it('download rejects an unknown id and surfaces the downloader error', async () => {
    const { ctx } = makeCtx();
    await expect(asrModelDownload(ctx, { id: 'nope' })).rejects.toThrow(/unknown model/);
    await expect(asrModelDownload(ctx, { id: 'tiny' })).rejects.toThrow(/HTTP 503/);
  });

  it('announces a failed download as an error and still rejects', async () => {
    const { ctx } = makeCtx();
    const ended: unknown[] = [];
    await expect(asrModelDownloadAnnounced(ctx, { id: 'tiny' }, (e) => ended.push(e))).rejects.toThrow(/HTTP 503/);
    expect(ended).toEqual([{ id: 'tiny', outcome: 'error', error: expect.stringMatching(/HTTP 503/) }]);
  });

  it('announces a completed download', async () => {
    const body = Buffer.from('abc');
    const fetchImpl = (async () => new Response(new Uint8Array(body), { status: 200 })) as typeof fetch;
    const { ctx } = makeCtx({ fetch: fetchImpl });
    const tiny: AsrModelCatalogEntry = {
      ...catalogEntryById('tiny')!,
      sha256: createHash('sha256').update(body).digest('hex'),
      sizeBytes: body.byteLength,
    };
    const ended: unknown[] = [];
    await expect(
      asrModelDownloadAnnounced({ ...ctx, catalog: [tiny] }, { id: 'tiny' }, (e) => ended.push(e)),
    ).resolves.toBe('complete');
    expect(ended).toEqual([{ id: 'tiny', outcome: 'complete' }]);
  });

  it('cancel is a no-op for an id that is not downloading', () => {
    const { ctx } = makeCtx();
    expect(() => asrModelCancelDownload(ctx, { id: 'tiny' })).not.toThrow();
  });

  it('download applies the model when it completes and no model was active', async () => {
    const body = Buffer.from('abc');
    const fetchImpl = (async () => new Response(new Uint8Array(body), { status: 200 })) as typeof fetch;
    const root = mkdtempSync(path.join(tmpdir(), 'asr-ipc-'));
    dirs.push(root);
    const modelsDir = path.join(root, 'models');
    mkdirSync(modelsDir);
    const store = new AsrModelStore({ modelsDir, configDir: path.join(root, 'config'), env: {} });
    const downloader = new ModelDownloader({ modelsDir, fetch: fetchImpl, onProgress: () => undefined });
    const applyModelPath = vi.fn(async (_p: string | null, _t?: number) => undefined);
    // Same id and filename as the real tiny entry, so the store resolves
    // the downloaded file, but with the fake body's checksum and size.
    const tiny: AsrModelCatalogEntry = {
      ...catalogEntryById('tiny')!,
      sha256: createHash('sha256').update(body).digest('hex'),
      sizeBytes: body.byteLength,
    };
    const ctx: AsrModelIpcContext = { store, downloader, applyModelPath, catalog: [tiny] };

    await expect(asrModelDownload(ctx, { id: 'tiny' })).resolves.toBe('complete');

    expect(store.readSelection()).toBe('tiny');
    expect(applyModelPath).toHaveBeenCalledWith(path.join(modelsDir, 'ggml-tiny.bin'), 60_000 + 60_000);
  });
});

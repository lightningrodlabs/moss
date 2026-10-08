// Pure-logic handlers for the model-management channels. Electron-free
// so the routing can be unit-tested; wireUp.ts adapts them to ipcMain.
//
//   'asr-models-list'            → AsrModelListEntry[]
//   'asr-model-download'         { id } → 'complete' | 'cancelled'  (resolves when the download ends)
//   'asr-model-cancel-download'  { id } → void
//   'asr-model-delete'           { id } → void
//   'asr-model-select'           { id } → void
//   'asr-model-download-progress' (send) main → every window

import type { AsrModelListEntry } from '@theweave/moss-types';

import {
  ASR_MODEL_CATALOG,
  type AsrModelCatalogEntry,
  catalogEntryForPath,
} from './modelCatalog';
import type { DownloadOutcome, ModelDownloader } from './modelDownloader';
import type { AsrModelStore } from './modelStore';

export interface AsrModelIpcContext {
  store: AsrModelStore;
  downloader: ModelDownloader;
  /** Hands the resolved path to the service, which swaps or creates the broker. */
  applyModelPath: (modelPath: string | null, startTimeoutMs?: number) => Promise<void>;
  /** Test seam: entries to download from. Defaults to ASR_MODEL_CATALOG. */
  catalog?: readonly AsrModelCatalogEntry[];
}

export interface AsrModelIdRequest {
  id: string;
}

function entryById(ctx: AsrModelIpcContext, id: string): AsrModelCatalogEntry {
  const entry = (ctx.catalog ?? ASR_MODEL_CATALOG).find((e) => e.id === id);
  if (!entry) throw new Error(`unknown model ${id}`);
  return entry;
}

export function asrModelsList(ctx: AsrModelIpcContext): AsrModelListEntry[] {
  return ctx.store.listModels();
}

export async function asrModelDownload(
  ctx: AsrModelIpcContext,
  req: AsrModelIdRequest,
): Promise<DownloadOutcome> {
  const entry = entryById(ctx, req.id);
  const hadModel = ctx.store.resolveActiveModelPath() !== null;
  const outcome = await ctx.downloader.download(entry);
  // An install with no model at all becomes usable as soon as the first
  // download lands, without a second click.
  if (outcome === 'complete' && !hadModel) {
    await asrModelSelect(ctx, { id: req.id });
  }
  return outcome;
}

export function asrModelCancelDownload(ctx: AsrModelIpcContext, req: AsrModelIdRequest): void {
  ctx.downloader.cancel(req.id);
}

export async function asrModelSelect(ctx: AsrModelIpcContext, req: AsrModelIdRequest): Promise<void> {
  entryById(ctx, req.id);
  if (!ctx.store.installedPathFor(req.id)) throw new Error(`model ${req.id} is not installed`);
  ctx.store.writeSelection(req.id);
  await applyResolved(ctx);
}

export async function asrModelDelete(ctx: AsrModelIpcContext, req: AsrModelIdRequest): Promise<void> {
  const wasActive = ctx.store.activeModelId() === req.id;
  ctx.store.deleteModel(req.id);
  if (wasActive) await applyResolved(ctx);
}

/** Push whatever the store now resolves to, with that model's start budget when it is a catalog model. */
async function applyResolved(ctx: AsrModelIpcContext): Promise<void> {
  const p = ctx.store.resolveActiveModelPath();
  const entry = p ? catalogEntryForPath(p) : undefined;
  await ctx.applyModelPath(p, entry?.startTimeoutMs);
}

// src/main/asr/modelStore.ts
// Where whisper models live on this install and which one the user chose.
// Downloaded models sit in the profile's data dir; the choice is a small
// JSON file in the profile's config dir so it survives a data reset of the
// models directory. The bundled model under resources/ is read-only and
// always counts as installed.

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { AsrModelListEntry } from '@theweave/moss-types';

import {
  ASR_MODEL_CATALOG,
  type AsrModelCatalogEntry,
  catalogEntryById,
  catalogEntryForPath,
} from './modelCatalog';

export const ASR_MODEL_SELECTION_FILE = 'asr-model.json';
export const BUNDLED_ASR_MODEL_FILENAME = 'ggml-base.en.bin';

export interface AsrModelStoreOptions {
  /** Downloaded models. */
  modelsDir: string;
  /** Holds the selection file. */
  configDir: string;
  /** resources/models from the installer, when present. */
  bundledModelsDir?: string;
  /** Dev-only spike model directory. */
  spikeModelsDir?: string;
  env?: NodeJS.ProcessEnv;
}

type StoredSelection = { modelId: string };

export class AsrModelStore {
  readonly modelsDir: string;
  private readonly configDir: string;
  private readonly bundledModelsDir: string | undefined;
  private readonly spikeModelsDir: string | undefined;
  private readonly env: NodeJS.ProcessEnv;

  constructor(opts: AsrModelStoreOptions) {
    this.modelsDir = opts.modelsDir;
    this.configDir = opts.configDir;
    this.bundledModelsDir = opts.bundledModelsDir;
    this.spikeModelsDir = opts.spikeModelsDir;
    this.env = opts.env ?? process.env;
  }

  readSelection(): string | undefined {
    const file = path.join(this.configDir, ASR_MODEL_SELECTION_FILE);
    try {
      if (!existsSync(file)) return undefined;
      const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<StoredSelection>;
      return typeof parsed.modelId === 'string' ? parsed.modelId : undefined;
    } catch {
      return undefined;
    }
  }

  writeSelection(id: string | undefined): void {
    const file = path.join(this.configDir, ASR_MODEL_SELECTION_FILE);
    if (id === undefined) {
      rmSync(file, { force: true });
      return;
    }
    mkdirSync(this.configDir, { recursive: true });
    const setting: StoredSelection = { modelId: id };
    writeFileSync(file, JSON.stringify(setting, null, 2), 'utf-8');
  }

  downloadedPathFor(entry: AsrModelCatalogEntry): string {
    return path.join(this.modelsDir, entry.filename);
  }

  partPathFor(entry: AsrModelCatalogEntry): string {
    return `${this.downloadedPathFor(entry)}.part`;
  }

  private bundledPathFor(entry: AsrModelCatalogEntry): string | null {
    if (!this.bundledModelsDir) return null;
    const p = path.join(this.bundledModelsDir, entry.filename);
    return existsSync(p) ? p : null;
  }

  /** Path of a complete copy of the model, downloaded first, else bundled; null when not installed. */
  installedPathFor(id: string): string | null {
    const entry = catalogEntryById(id);
    if (!entry) return null;
    const downloaded = this.downloadedPathFor(entry);
    if (existsSync(downloaded)) return downloaded;
    return this.bundledPathFor(entry);
  }

  /**
   * The model the sidecar should load. An explicit env override wins so CI
   * and tool authors can point at any file; after that the user's choice,
   * then the bundled model, then the dev spike copy.
   */
  resolveActiveModelPath(): string | null {
    const fromEnv = this.env.MOSS_ASR_MODEL;
    if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
    const chosen = this.readSelection();
    if (chosen) {
      const p = this.installedPathFor(chosen);
      if (p) return p;
    }
    const candidates: string[] = [];
    if (this.bundledModelsDir) {
      candidates.push(path.join(this.bundledModelsDir, BUNDLED_ASR_MODEL_FILENAME));
    }
    if (this.spikeModelsDir) {
      candidates.push(path.join(this.spikeModelsDir, BUNDLED_ASR_MODEL_FILENAME));
    }
    return candidates.find((c) => existsSync(c)) ?? null;
  }

  activeModelId(): string | undefined {
    const p = this.resolveActiveModelPath();
    return p ? catalogEntryForPath(p)?.id : undefined;
  }

  listModels(): AsrModelListEntry[] {
    const active = this.activeModelId();
    return ASR_MODEL_CATALOG.map((entry) => {
      const bundled = this.bundledPathFor(entry) !== null;
      const installed = bundled || existsSync(this.downloadedPathFor(entry));
      const partPath = this.partPathFor(entry);
      const partialBytes = existsSync(partPath) ? statSync(partPath).size : undefined;
      const row: AsrModelListEntry = {
        id: entry.id,
        sizeBytes: entry.sizeBytes,
        languages: entry.languages,
        latencyTier: entry.latencyTier,
        installed,
        bundled,
        active: entry.id === active,
      };
      if (partialBytes !== undefined) row.partialBytes = partialBytes;
      return row;
    });
  }

  /** Remove a downloaded model and any partial download. The bundled copy stays. */
  deleteModel(id: string): void {
    const entry = catalogEntryById(id);
    if (!entry) throw new Error(`unknown model ${id}`);
    const downloaded = this.downloadedPathFor(entry);
    const part = this.partPathFor(entry);
    if (!existsSync(downloaded) && !existsSync(part)) {
      if (this.bundledPathFor(entry))
        throw new Error(`${id} is bundled with Moss and cannot be deleted`);
      return;
    }
    rmSync(downloaded, { force: true });
    rmSync(part, { force: true });
    if (this.readSelection() === id) this.writeSelection(undefined);
  }
}

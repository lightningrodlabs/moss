# ASR Model Download and Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Moss user download whisper speech models from Settings > Services > Transcription and pick which one is active; the active model is the one every tool gets.

**Architecture:** A checked-in catalog of ggml whisper models, a profile-scoped model store that knows what is installed and which is chosen, a resumable downloader, and a broker that can swap its sidecar config. New IPC channels expose list/download/cancel/delete/select to the renderer; the settings pane renders a model list and confirms a swap when tool sessions are open. No change to `@theweave/api`.

**Tech Stack:** Electron main (plain Node modules under `src/main/asr/`), vitest unit tests (`yarn test:unit`), Lit + Shoelace renderer, `@lit/localize` for strings.

**Spec:** `docs/superpowers/specs/2026-10-07-asr-model-download-design.md`

## Global Constraints

- Strong typing everywhere; no `any`.
- Code comments explain intent, never prior behavior.
- New main-process modules under `src/main/asr/` import no `electron`; `wireUp.ts` stays the only Electron-aware file.
- Every IPC channel name is a string literal at the `ipcRenderer.invoke` and `ipcMain.handle` call sites (the drift test scans literals).
- Commit messages: no Claude attribution lines.
- Run tests from the worktree root: `yarn vitest run <path>`. The two `src/main/lanBeacon/socket.test.ts` failures are pre-existing (UDP blocked in the sandbox) and are not yours.
- Gate before each commit: the task's tests pass. Gate before the final commit: `yarn typecheck` and `yarn test:unit` (except the two lanBeacon cases).

## Review Focus

Inputs the spec implies but a task's tests could miss; each has a test added in the owning task.

1. A `.part` file that is already as large as (or larger than) the model, so a `Range` request would get HTTP 416: the downloader must discard it and start fresh. (Task 3)
2. `$MOSS_ASR_MODEL` pointing at a file that is not in the catalog: capabilities must still report via the filename parse and no row is "active". (Tasks 1, 2)
3. Selecting a model while the sidecar is still cold-starting: the swap must wait for the start, then stop that server, not orphan it. (Task 4)
4. Deleting the active model: selection file cleared, resolution falls back to bundled, broker swapped. (Tasks 2, 6)
5. A second download request for an id already downloading must not open a second stream or clobber the `.part`. (Task 3)

---

### Task 1: Model catalog

**Files:**
- Create: `shared/types/src/asr-models.ts` (types shared by main, preload and renderer)
- Modify: `shared/types/src/index.ts`
- Create: `src/main/asr/modelCatalog.ts`
- Create: `src/main/asr/__tests__/modelCatalog.test.ts`
- Modify: `src/main/asr/capabilities.ts`
- Modify: `src/main/asr/__tests__/capabilities.test.ts`

**Interfaces:**
- Produces in `@theweave/moss-types`: `AsrLatencyTier`, `AsrModelListEntry`, `AsrModelDownloadProgress`.
- Produces in main: `AsrModelCatalogEntry`, `ASR_MODEL_CATALOG`, `catalogEntryById(id)`, `catalogEntryForPath(p)`, `WHISPER_MULTILINGUAL_CODES` (moved here; `capabilities.ts` re-exports it).

- [ ] **Step 0: Add the shared types**

```ts
// shared/types/src/asr-models.ts
// Shapes that cross the main ↔ preload ↔ renderer boundary for the speech
// model list under Settings > Services > Transcription.

export type AsrLatencyTier = 'fast' | 'ok' | 'slow';

/** One row of the model list: a catalog entry plus its state on this install. */
export interface AsrModelListEntry {
  /** Short name as whisper.cpp uses it, e.g. 'base.en'. */
  id: string;
  sizeBytes: number;
  /** ISO 639-1 codes the model transcribes. */
  languages: readonly string[];
  latencyTier: AsrLatencyTier;
  /** A complete copy exists, downloaded or bundled. */
  installed: boolean;
  /** Shipped with the installer; cannot be deleted. */
  bundled: boolean;
  /** This is the model the sidecar loads. */
  active: boolean;
  /** Size of a leftover partial download, when one exists. */
  partialBytes?: number;
}

export interface AsrModelDownloadProgress {
  id: string;
  bytes: number;
  total: number;
}
```

Add `export * from './asr-models.js';` to `shared/types/src/index.ts`, then rebuild the package so the other workspaces see it: `yarn workspace @theweave/moss-types build`.

- [ ] **Step 1: Write the failing catalog test**

```ts
// src/main/asr/__tests__/modelCatalog.test.ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn vitest run src/main/asr/__tests__/modelCatalog.test.ts`
Expected: FAIL, cannot resolve `../modelCatalog`.

- [ ] **Step 3: Write the catalog**

Move the `WHISPER_MULTILINGUAL_CODES` array out of `capabilities.ts` into this file verbatim (same 99 codes, same doc comment).

```ts
// src/main/asr/modelCatalog.ts
// The whisper models Moss can download, as published by whisper.cpp on
// HuggingFace. Checked in rather than fetched so an install can show the
// list offline and verify every download against a known checksum. The
// sha256 and size come from the LFS pointer at
// https://huggingface.co/ggerganov/whisper.cpp/raw/main/<filename>.

import path from 'node:path';

import type { AsrLatencyTier } from '@theweave/moss-types';

export interface AsrModelCatalogEntry {
  /** Short name as whisper.cpp uses it, e.g. 'base.en'. */
  id: string;
  /** File name on disk and on HuggingFace, e.g. 'ggml-base.en.bin'. */
  filename: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  /** ISO 639-1 codes the model transcribes. */
  languages: readonly string[];
  latencyTier: AsrLatencyTier;
  /** Readiness budget for whisper-server loading this model on a cold cache. */
  startTimeoutMs: number;
}

export const WHISPER_MULTILINGUAL_CODES: readonly string[] = Object.freeze([
  // ... paste the 99 codes from capabilities.ts unchanged ...
]);

const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';

/** One minute to come up, plus a minute per gigabyte to page the weights in. */
function startTimeoutForSize(sizeBytes: number): number {
  return 60_000 + Math.ceil(sizeBytes / 1_000_000_000) * 60_000;
}

function entry(
  id: string,
  sha256: string,
  sizeBytes: number,
  latencyTier: AsrLatencyTier,
): AsrModelCatalogEntry {
  const filename = `ggml-${id}.bin`;
  return {
    id,
    filename,
    url: HF_BASE + filename,
    sha256,
    sizeBytes,
    languages: id.endsWith('.en') ? ['en'] : WHISPER_MULTILINGUAL_CODES,
    latencyTier,
    startTimeoutMs: startTimeoutForSize(sizeBytes),
  };
}

export const ASR_MODEL_CATALOG: readonly AsrModelCatalogEntry[] = Object.freeze([
  entry('tiny', 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21', 77_691_713, 'fast'),
  entry('tiny.en', '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f', 77_704_715, 'fast'),
  entry('base', '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe', 147_951_465, 'ok'),
  entry('base.en', 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002', 147_964_211, 'ok'),
  entry('small', '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b', 487_601_967, 'ok'),
  entry('small.en', 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d', 487_614_201, 'ok'),
  entry('medium', '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208', 1_533_763_059, 'slow'),
  entry('medium.en', 'cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356', 1_533_774_781, 'slow'),
  entry('large-v3-turbo', '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69', 1_624_555_275, 'slow'),
  entry('large-v3', '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2', 3_095_033_483, 'slow'),
]);

export function catalogEntryById(id: string): AsrModelCatalogEntry | undefined {
  return ASR_MODEL_CATALOG.find((e) => e.id === id);
}

/** Match a model file by its base name, so overrides pointing at a catalog file still get catalog metadata. */
export function catalogEntryForPath(p: string): AsrModelCatalogEntry | undefined {
  const base = path.basename(p);
  return ASR_MODEL_CATALOG.find((e) => e.filename === base);
}
```

- [ ] **Step 4: Make capabilities prefer the catalog entry**

In `src/main/asr/capabilities.ts`: delete the local `WHISPER_MULTILINGUAL_CODES` definition and replace it with an import plus re-export; use the catalog entry when the path matches one.

```ts
import { WHISPER_MULTILINGUAL_CODES, catalogEntryForPath } from './modelCatalog';

export { WHISPER_MULTILINGUAL_CODES };

export function computeAsrCapabilities(input: ComputeAsrCapabilitiesInput): LocalModelCapabilities {
  if (!input.modelPath) {
    return {
      asr: { available: false, languages: [], streaming: false, model: '', latencyTier: input.latencyTier ?? 'ok' },
    };
  }
  const entry = catalogEntryForPath(input.modelPath);
  const { model, languages } = entry
    ? { model: entry.id, languages: [...entry.languages] }
    : parseModelFilename(input.modelPath);
  return {
    asr: {
      available: true,
      languages,
      streaming: false,
      model,
      latencyTier: input.latencyTier ?? entry?.latencyTier ?? 'ok',
    },
  };
}
```

Update the header comment: language inference now comes from the catalog, with the filename convention as the fallback for files outside it.

- [ ] **Step 5: Add a capabilities test for the catalog path and the non-catalog override**

Append to `src/main/asr/__tests__/capabilities.test.ts`:

```ts
  it('takes the latency tier from the catalog when the file is a catalog model', () => {
    const caps = computeAsrCapabilities({ modelPath: '/x/ggml-medium.bin' });
    expect(caps.asr.latencyTier).toBe('slow');
    expect(caps.asr.model).toBe('medium');
  });

  it('falls back to the filename parse for a file outside the catalog', () => {
    const caps = computeAsrCapabilities({ modelPath: '/x/ggml-custom.en.bin' });
    expect(caps.asr.model).toBe('custom.en');
    expect(caps.asr.languages).toEqual(['en']);
    expect(caps.asr.latencyTier).toBe('ok');
  });
```

- [ ] **Step 6: Run both test files**

Run: `yarn vitest run src/main/asr/__tests__/modelCatalog.test.ts src/main/asr/__tests__/capabilities.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/types/src/asr-models.ts shared/types/src/index.ts src/main/asr/modelCatalog.ts src/main/asr/capabilities.ts src/main/asr/__tests__/modelCatalog.test.ts src/main/asr/__tests__/capabilities.test.ts
git commit -m "feat(asr): checked-in catalog of downloadable whisper models"
```

---

### Task 2: Model store and profile models directory

**Files:**
- Create: `src/main/asr/modelStore.ts`
- Create: `src/main/asr/__tests__/modelStore.test.ts`
- Modify: `src/main/filesystem.ts` (add `modelsDir`)
- Modify: `src/main/asr/asrService.ts` (remove `defaultModelPath`, `BUNDLED_ASR_MODEL_FILENAME` stays)
- Modify: `src/main/asr/__tests__/asrService.test.ts` (drop `defaultModelPath` cases)
- Modify: `src/main/asr/index.ts` (export the store, drop `defaultModelPath`)

**Interfaces:**
- Consumes: `catalogEntryById`, `catalogEntryForPath`, `ASR_MODEL_CATALOG` from Task 1.
- Produces (`AsrModelListEntry` comes from `@theweave/moss-types`, Task 1):

```ts
export interface AsrModelStoreOptions {
  modelsDir: string; configDir: string; bundledModelsDir?: string; spikeModelsDir?: string; env?: NodeJS.ProcessEnv;
}
export class AsrModelStore {
  constructor(opts: AsrModelStoreOptions);
  readonly modelsDir: string;
  readSelection(): string | undefined;
  writeSelection(id: string | undefined): void;
  installedPathFor(id: string): string | null;
  resolveActiveModelPath(): string | null;
  activeModelId(): string | undefined;
  listModels(): AsrModelListEntry[];
  deleteModel(id: string): void;
}
```

- [ ] **Step 1: Write the failing store test**

```ts
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
    expect(byId['medium']).toMatchObject({ installed: false, bundled: false, active: false, partialBytes: 5 });
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
    expect(store.listModels().find((e) => e.id === 'base.en')).toMatchObject({ installed: true, bundled: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn vitest run src/main/asr/__tests__/modelStore.test.ts`
Expected: FAIL, cannot resolve `../modelStore`.

- [ ] **Step 3: Write the store**

```ts
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
      if (this.bundledPathFor(entry)) throw new Error(`${id} is bundled with Moss and cannot be deleted`);
      return;
    }
    rmSync(downloaded, { force: true });
    rmSync(part, { force: true });
    if (this.readSelection() === id) this.writeSelection(undefined);
  }
}
```

- [ ] **Step 4: Run the store test**

Run: `yarn vitest run src/main/asr/__tests__/modelStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `modelsDir` to the profile filesystem**

In `src/main/filesystem.ts`, next to the other dirs on `MossFileSystem`:

```ts
  public modelsDir: string;
  // in the constructor, after feedbackDir:
    this.modelsDir = path.join(profileDataDir, 'models');
    createDirIfNotExists(this.modelsDir);
```

Add `models/                     # downloaded speech models` to the layout block in `CLAUDE.md` under `data/`.

- [ ] **Step 6: Remove `defaultModelPath` from the service**

In `src/main/asr/asrService.ts` delete `defaultModelPath` and its doc comment, delete the `existsSync`/`path` imports if now unused, and replace the local `BUNDLED_ASR_MODEL_FILENAME` constant with `import { BUNDLED_ASR_MODEL_FILENAME } from './modelStore';` plus `export { BUNDLED_ASR_MODEL_FILENAME };` (the error message in `getAsrBroker` still uses it; `grep -rn BUNDLED_ASR_MODEL_FILENAME src` shows no other importer). In `src/main/asr/index.ts` remove `defaultModelPath` from the `asrService` export list and add:

```ts
export { AsrModelStore, ASR_MODEL_SELECTION_FILE, BUNDLED_ASR_MODEL_FILENAME } from './modelStore';
export type { AsrModelStoreOptions } from './modelStore';
export { ASR_MODEL_CATALOG, catalogEntryById, catalogEntryForPath } from './modelCatalog';
export type { AsrModelCatalogEntry } from './modelCatalog';
```

In `src/main/asr/__tests__/asrService.test.ts` remove the `defaultModelPath` import and every `describe`/`it` that calls it (search for `defaultModelPath`).

`wireUp.ts` still calls `defaultModelPath`; leave it broken for now, Task 6 rewrites that file. Confirm with `grep -rn defaultModelPath src scripts` that only `wireUp.ts` remains.

- [ ] **Step 7: Run the asr tests**

Run: `yarn vitest run src/main/asr`
Expected: PASS for every file (wireUp has no unit test).

- [ ] **Step 8: Commit**

```bash
git add src/main/asr/modelStore.ts src/main/asr/__tests__/modelStore.test.ts src/main/filesystem.ts src/main/asr/asrService.ts src/main/asr/__tests__/asrService.test.ts src/main/asr/index.ts CLAUDE.md
git commit -m "feat(asr): profile model store with saved selection and resolution order"
```

---

### Task 3: Resumable model downloader

**Files:**
- Create: `src/main/asr/modelDownloader.ts`
- Create: `src/main/asr/__tests__/modelDownloader.test.ts`
- Modify: `src/main/asr/index.ts`

**Interfaces:**
- Consumes: `AsrModelCatalogEntry` (Task 1).
- Produces (`DownloadProgress` is an alias of `AsrModelDownloadProgress` from `@theweave/moss-types`):

```ts
export type DownloadProgress = AsrModelDownloadProgress;
export type DownloadOutcome = 'complete' | 'cancelled';
export interface ModelDownloaderOptions {
  modelsDir: string; fetch?: typeof fetch; onProgress: (p: DownloadProgress) => void; progressIntervalMs?: number;
}
export class ModelDownloader {
  constructor(opts: ModelDownloaderOptions);
  download(entry: AsrModelCatalogEntry): Promise<DownloadOutcome>;
  cancel(id: string): void;
  isDownloading(id: string): boolean;
}
```

- [ ] **Step 1: Write the failing downloader test**

```ts
// src/main/asr/__tests__/modelDownloader.test.ts
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AsrModelCatalogEntry } from '../modelCatalog';
import { type DownloadProgress, ModelDownloader } from '../modelDownloader';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const BODY = Buffer.from('0123456789abcdef'.repeat(64)); // 1024 bytes

function entryFor(body: Buffer, overrides: Partial<AsrModelCatalogEntry> = {}): AsrModelCatalogEntry {
  return {
    id: 'tiny',
    filename: 'ggml-tiny.bin',
    url: 'https://example.test/ggml-tiny.bin',
    sha256: createHash('sha256').update(body).digest('hex'),
    sizeBytes: body.byteLength,
    languages: ['en'],
    latencyTier: 'fast',
    startTimeoutMs: 60_000,
    ...overrides,
  };
}

interface FakeFetchCall {
  url: string;
  range: string | null;
}

/**
 * Serves `body` in `chunk`-byte pieces. Honors Range unless `ignoreRange`.
 * With `hangAfter`, stops after that many chunks and only ends when the
 * request is aborted, so cancel paths can be exercised.
 */
function fakeFetch(
  body: Buffer,
  opts: { chunk?: number; ignoreRange?: boolean; hangAfter?: number; status?: number } = {},
): { fetch: typeof fetch; calls: FakeFetchCall[] } {
  const calls: FakeFetchCall[] = [];
  const chunk = opts.chunk ?? 256;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const range = new Headers(init?.headers).get('range');
    calls.push({ url: String(input), range });
    if (opts.status) return new Response(null, { status: opts.status });
    let start = 0;
    let status = 200;
    if (range && !opts.ignoreRange) {
      start = Number(/bytes=(\d+)-/.exec(range)![1]);
      if (start >= body.byteLength) return new Response(null, { status: 416 });
      status = 206;
    }
    const signal = init?.signal ?? null;
    let sent = 0;
    let offset = start;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (opts.hangAfter !== undefined && sent >= opts.hangAfter) {
          return new Promise<void>((_, reject) => {
            signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          });
        }
        if (offset >= body.byteLength) {
          controller.close();
          return;
        }
        const end = Math.min(offset + chunk, body.byteLength);
        controller.enqueue(new Uint8Array(body.subarray(offset, end)));
        offset = end;
        sent += 1;
      },
    });
    return new Response(stream, { status });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function makeDownloader(fetchImpl: typeof fetch) {
  const modelsDir = mkdtempSync(path.join(tmpdir(), 'asr-dl-'));
  dirs.push(modelsDir);
  const progress: DownloadProgress[] = [];
  const downloader = new ModelDownloader({
    modelsDir,
    fetch: fetchImpl,
    onProgress: (p) => progress.push(p),
    progressIntervalMs: 0,
  });
  return { downloader, modelsDir, progress };
}

describe('ModelDownloader', () => {
  it('downloads, verifies and renames the file, reporting progress to the end', async () => {
    const { fetch, calls } = fakeFetch(BODY);
    const { downloader, modelsDir, progress } = makeDownloader(fetch);
    const entry = entryFor(BODY);

    await expect(downloader.download(entry)).resolves.toBe('complete');

    expect(calls).toEqual([{ url: entry.url, range: null }]);
    expect(readFileSync(path.join(modelsDir, 'ggml-tiny.bin'))).toEqual(BODY);
    expect(existsSync(path.join(modelsDir, 'ggml-tiny.bin.part'))).toBe(false);
    expect(progress.at(-1)).toEqual({ id: 'tiny', bytes: 1024, total: 1024 });
    expect(progress.length).toBeGreaterThanOrEqual(4);
    expect(downloader.isDownloading('tiny')).toBe(false);
  });

  it('resumes a .part with a Range request when the server answers 206', async () => {
    const { fetch, calls } = fakeFetch(BODY);
    const { downloader, modelsDir } = makeDownloader(fetch);
    writeFileSync(path.join(modelsDir, 'ggml-tiny.bin.part'), BODY.subarray(0, 300));

    await expect(downloader.download(entryFor(BODY))).resolves.toBe('complete');

    expect(calls[0].range).toBe('bytes=300-');
    expect(readFileSync(path.join(modelsDir, 'ggml-tiny.bin'))).toEqual(BODY);
  });

  it('starts over when the server ignores Range and answers 200', async () => {
    const { fetch } = fakeFetch(BODY, { ignoreRange: true });
    const { downloader, modelsDir } = makeDownloader(fetch);
    writeFileSync(path.join(modelsDir, 'ggml-tiny.bin.part'), Buffer.from('garbage'));

    await expect(downloader.download(entryFor(BODY))).resolves.toBe('complete');
    expect(readFileSync(path.join(modelsDir, 'ggml-tiny.bin'))).toEqual(BODY);
  });

  it('discards a .part that is already full size instead of asking for an impossible range', async () => {
    const { fetch, calls } = fakeFetch(BODY);
    const { downloader, modelsDir } = makeDownloader(fetch);
    writeFileSync(path.join(modelsDir, 'ggml-tiny.bin.part'), Buffer.alloc(BODY.byteLength, 1));

    await expect(downloader.download(entryFor(BODY))).resolves.toBe('complete');
    expect(calls[0].range).toBeNull();
    expect(readFileSync(path.join(modelsDir, 'ggml-tiny.bin'))).toEqual(BODY);
  });

  it('cancel keeps the .part for a later resume and resolves cancelled', async () => {
    const { fetch } = fakeFetch(BODY, { hangAfter: 2 });
    const { downloader, modelsDir } = makeDownloader(fetch);
    const entry = entryFor(BODY);

    const outcome = downloader.download(entry);
    while (!existsSync(path.join(modelsDir, 'ggml-tiny.bin.part')) || statSync(path.join(modelsDir, 'ggml-tiny.bin.part')).size < 512) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(downloader.isDownloading('tiny')).toBe(true);
    downloader.cancel('tiny');

    await expect(outcome).resolves.toBe('cancelled');
    expect(statSync(path.join(modelsDir, 'ggml-tiny.bin.part')).size).toBe(512);
    expect(existsSync(path.join(modelsDir, 'ggml-tiny.bin'))).toBe(false);
    expect(downloader.isDownloading('tiny')).toBe(false);
  });

  it('deletes the file and rejects on a checksum mismatch', async () => {
    const { fetch } = fakeFetch(BODY);
    const { downloader, modelsDir } = makeDownloader(fetch);
    const entry = entryFor(BODY, { sha256: 'f'.repeat(64) });

    await expect(downloader.download(entry)).rejects.toThrow(/checksum mismatch for tiny/);
    expect(existsSync(path.join(modelsDir, 'ggml-tiny.bin'))).toBe(false);
    expect(existsSync(path.join(modelsDir, 'ggml-tiny.bin.part'))).toBe(false);
  });

  it('rejects with the HTTP status and keeps nothing on a failed request', async () => {
    const { fetch } = fakeFetch(BODY, { status: 503 });
    const { downloader } = makeDownloader(fetch);
    await expect(downloader.download(entryFor(BODY))).rejects.toThrow(/HTTP 503/);
  });

  it('shares one in-flight download per id', async () => {
    const { fetch, calls } = fakeFetch(BODY, { hangAfter: 1 });
    const { downloader } = makeDownloader(fetch);
    const entry = entryFor(BODY);

    const a = downloader.download(entry);
    const b = downloader.download(entry);
    expect(b).toBe(a);
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(1);
    downloader.cancel('tiny');
    await expect(a).resolves.toBe('cancelled');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn vitest run src/main/asr/__tests__/modelDownloader.test.ts`
Expected: FAIL, cannot resolve `../modelDownloader`.

- [ ] **Step 3: Write the downloader**

```ts
// src/main/asr/modelDownloader.ts
// Streams a catalog model into the profile's models directory. Writes go
// to <filename>.part so a half-finished file is never mistaken for a
// model; the rename happens only after the checksum matches. A leftover
// .part is resumed with a Range request, which is what makes a
// multi-gigabyte download survive a flaky connection or an app restart.

import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  type WriteStream,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { AsrModelDownloadProgress } from '@theweave/moss-types';

import type { AsrModelCatalogEntry } from './modelCatalog';

export type DownloadProgress = AsrModelDownloadProgress;

export type DownloadOutcome = 'complete' | 'cancelled';

export interface ModelDownloaderOptions {
  modelsDir: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  onProgress: (p: DownloadProgress) => void;
  /** Minimum gap between progress reports. Default 250 ms. */
  progressIntervalMs?: number;
}

interface InFlight {
  controller: AbortController;
  promise: Promise<DownloadOutcome>;
}

export class ModelDownloader {
  private readonly modelsDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly onProgress: (p: DownloadProgress) => void;
  private readonly progressIntervalMs: number;
  private readonly inflight = new Map<string, InFlight>();

  constructor(opts: ModelDownloaderOptions) {
    this.modelsDir = opts.modelsDir;
    this.fetchImpl = opts.fetch ?? fetch;
    this.onProgress = opts.onProgress;
    this.progressIntervalMs = opts.progressIntervalMs ?? 250;
  }

  download(entry: AsrModelCatalogEntry): Promise<DownloadOutcome> {
    const existing = this.inflight.get(entry.id);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const promise = this.run(entry, controller.signal).finally(() => {
      this.inflight.delete(entry.id);
    });
    this.inflight.set(entry.id, { controller, promise });
    return promise;
  }

  cancel(id: string): void {
    this.inflight.get(id)?.controller.abort();
  }

  isDownloading(id: string): boolean {
    return this.inflight.has(id);
  }

  private async run(entry: AsrModelCatalogEntry, signal: AbortSignal): Promise<DownloadOutcome> {
    mkdirSync(this.modelsDir, { recursive: true });
    const finalPath = path.join(this.modelsDir, entry.filename);
    const partPath = `${finalPath}.part`;

    let offset = existsSync(partPath) ? statSync(partPath).size : 0;
    // A partial file at or past the full size cannot be resumed; the
    // server would answer 416. Throw it away and fetch from the start.
    if (offset >= entry.sizeBytes) {
      rmSync(partPath, { force: true });
      offset = 0;
    }

    const headers: Record<string, string> = {};
    if (offset > 0) headers.Range = `bytes=${offset}-`;

    let res: Response;
    try {
      res = await this.fetchImpl(entry.url, { headers, signal });
    } catch (err) {
      if (signal.aborted) return 'cancelled';
      throw new Error(`download of ${entry.id} failed: ${(err as Error).message}`);
    }

    const resumed = res.status === 206 && offset > 0;
    if (!resumed && !res.ok) {
      throw new Error(`download of ${entry.id} failed: HTTP ${res.status}`);
    }
    if (!res.body) {
      throw new Error(`download of ${entry.id} failed: empty response body`);
    }
    if (!resumed) offset = 0;

    let bytes = offset;
    let lastReport = 0;
    const report = (force: boolean): void => {
      const now = Date.now();
      if (!force && now - lastReport < this.progressIntervalMs) return;
      lastReport = now;
      this.onProgress({ id: entry.id, bytes, total: entry.sizeBytes });
    };

    const out = createWriteStream(partPath, { flags: resumed ? 'a' : 'w' });
    report(true);
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (!out.write(value)) await once(out, 'drain');
        report(false);
      }
    } catch (err) {
      await closeStream(out);
      if (signal.aborted) return 'cancelled';
      throw new Error(`download of ${entry.id} failed: ${(err as Error).message}`);
    }
    await closeStream(out);
    report(true);

    const actual = await sha256OfFile(partPath);
    if (actual !== entry.sha256) {
      rmSync(partPath, { force: true });
      throw new Error(`checksum mismatch for ${entry.id}: expected ${entry.sha256}, got ${actual}`);
    }
    renameSync(partPath, finalPath);
    return 'complete';
  }
}

function closeStream(out: WriteStream): Promise<void> {
  return new Promise((resolve) => out.end(() => resolve()));
}

async function sha256OfFile(p: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(p), hash);
  return hash.digest('hex');
}
```

Add to `src/main/asr/index.ts`:

```ts
export { ModelDownloader } from './modelDownloader';
export type { DownloadOutcome, DownloadProgress, ModelDownloaderOptions } from './modelDownloader';
```

- [ ] **Step 4: Run the downloader test**

Run: `yarn vitest run src/main/asr/__tests__/modelDownloader.test.ts`
Expected: PASS. If the cancel test hangs, the reader's `read()` is not rejecting on abort: confirm the fake's `pull` registers the abort listener before returning its promise, and that `signal` is the one passed through `init`.

- [ ] **Step 5: Commit**

```bash
git add src/main/asr/modelDownloader.ts src/main/asr/__tests__/modelDownloader.test.ts src/main/asr/index.ts
git commit -m "feat(asr): resumable, checksummed model downloader"
```

---

### Task 4: Broker config swap and host-side session abort

**Files:**
- Modify: `src/main/asr/session.ts` (add `abort`)
- Modify: `src/main/asr/broker.ts` (track sessions, `setServerConfig`)
- Modify: `src/main/asr/__tests__/broker.test.ts`
- Modify: `src/main/asr/__tests__/session.test.ts`

**Interfaces:**
- Produces: `AsrSession.abort(reason: Error): void`; `AsrBroker.setServerConfig(next: WhisperServerConfig): Promise<void>`; `AsrBroker.serverConfig: WhisperServerConfig` (getter).

- [ ] **Step 1: Write the failing session test**

Append to `src/main/asr/__tests__/session.test.ts` (it already imports `AsrSession`, `FakeWhisperServer` and `asWhisperServer`):

```ts
describe('AsrSession.abort', () => {
  it('reports the reason to error listeners, drops buffered audio and releases the server once', async () => {
    const fake = new FakeWhisperServer({ command: ['noop'], modelPath: '/dev/null' });
    await fake.start();
    let released = 0;
    const session = new AsrSession(asWhisperServer(fake), async () => {
      released += 1;
    });
    const errors: Error[] = [];
    session.onError((e) => errors.push(e));
    await session.pushAudio(new Int16Array(1600));

    session.abort(new Error('speech model changed'));
    await new Promise((r) => setTimeout(r, 0));

    expect(errors.map((e) => e.message)).toEqual(['speech model changed']);
    expect(released).toBe(1);
    expect(fake.transcribeCalls).toHaveLength(0);
    await session.close();
    expect(released).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn vitest run src/main/asr/__tests__/session.test.ts`
Expected: FAIL, `session.abort is not a function`.

- [ ] **Step 3: Add `abort` to the session**

In `src/main/asr/session.ts`, after `close()`:

```ts
  /**
   * End the session from the host side, for example because the user
   * switched speech models. Listeners get `reason`, buffered audio is
   * dropped rather than transcribed, and the server is released once.
   */
  abort(reason: Error): void {
    this.fail(reason);
  }
```

- [ ] **Step 4: Run the session test**

Run: `yarn vitest run src/main/asr/__tests__/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing broker tests**

Append to `src/main/asr/__tests__/broker.test.ts`:

```ts
describe('AsrBroker.setServerConfig', () => {
  const nextConfig = { command: ['noop'], modelPath: '/models/ggml-small.bin' };

  it('just stores the config when nothing is loaded', async () => {
    const { broker, fakes } = makeBroker();
    await broker.setServerConfig(nextConfig);
    expect(fakes).toHaveLength(0);
    expect(broker.serverConfig).toEqual(nextConfig);
    await broker.openSession();
    expect(fakes[0].config.modelPath).toBe('/models/ggml-small.bin');
  });

  it('aborts open sessions, stops the server and cold-starts the next session with the new config', async () => {
    const { broker, fakes } = makeBroker({ idleTimeoutMs: 60_000 });
    const a = await broker.openSession();
    const b = await broker.openSession();
    const errors: string[] = [];
    a.onError((e) => errors.push(`a:${e.message}`));
    b.onError((e) => errors.push(`b:${e.message}`));

    await broker.setServerConfig(nextConfig);
    await sleep(0);

    expect(errors.sort()).toEqual(['a:speech model changed', 'b:speech model changed']);
    expect(fakes[0].stopCalls).toBe(1);
    expect(broker.isLoaded).toBe(false);
    expect(broker.openSessionCount).toBe(0);
    expect(broker.status).toBe('idle');

    await broker.openSession();
    expect(fakes).toHaveLength(2);
    expect(fakes[1].config.modelPath).toBe('/models/ggml-small.bin');
    expect(broker.openSessionCount).toBe(1);
  });

  it('waits for an in-flight cold start, then stops that server', async () => {
    const { broker, fakes } = makeBroker({ startDelayMs: 30 });
    const opening = broker.openSession();
    await sleep(5);
    const swap = broker.setServerConfig(nextConfig);
    const session = await opening;
    const errors: string[] = [];
    session.onError((e) => errors.push(e.message));
    await swap;
    await sleep(0);

    expect(fakes[0].startCalls).toBe(1);
    expect(fakes[0].stopCalls).toBe(1);
    expect(broker.isLoaded).toBe(false);
    expect(errors).toEqual(['speech model changed']);
  });

  it('ignores a late release from an aborted session so the count cannot go negative', async () => {
    const { broker } = makeBroker({ idleTimeoutMs: 60_000 });
    const s = await broker.openSession();
    await broker.setServerConfig(nextConfig);
    await s.close();
    const t = await broker.openSession();
    expect(broker.openSessionCount).toBe(1);
    await t.close();
    expect(broker.openSessionCount).toBe(0);
  });
});
```

The in-flight test is deliberately insensitive to microtask ordering: whether the session lands in the broker's set before or after the swap runs, it must end with exactly one `speech model changed` error. That is what the generation counter in Step 7 guarantees.

- [ ] **Step 6: Run to verify they fail**

Run: `yarn vitest run src/main/asr/__tests__/broker.test.ts`
Expected: FAIL, `broker.setServerConfig is not a function`.

- [ ] **Step 7: Implement the swap in the broker**

In `src/main/asr/broker.ts`:

```ts
  private serverConfigValue: WhisperServerConfig;
  /** Sessions the broker handed out and has not yet released. */
  private readonly sessions = new Set<AsrSession>();
  /** Bumped on every config swap so a session whose cold start straddled the swap is not handed a stale server. */
  private generation = 0;

  constructor(private readonly config: AsrBrokerConfig) {
    this.serverConfigValue = config.server;
    this.idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.factory = config.serverFactory ?? ((c) => new WhisperServer(c));
  }

  /** The config the next cold start will use. */
  get serverConfig(): WhisperServerConfig {
    return this.serverConfigValue;
  }

  async openSession(opts?: AsrSessionOptions): Promise<AsrSession> {
    if (this.destroyed) {
      throw new Error('AsrBroker is destroyed; cannot open new sessions');
    }
    const generation = this.generation;
    const server = await this.acquire();
    const session = new AsrSession(server, () => this.releaseSession(session), opts);
    this.sessions.add(session);
    if (generation !== this.generation) {
      session.abort(new Error('speech model changed'));
    }
    return session;
  }

  /**
   * Point the broker at a different model. Sessions that are open are
   * ended with an error so the user's choice takes effect now rather
   * than after every tool happens to close; the next session cold-starts
   * the new model.
   */
  async setServerConfig(next: WhisperServerConfig): Promise<void> {
    this.serverConfigValue = next;
    this.generation += 1;
    if (this.starting) {
      await this.starting.catch(() => undefined);
    }
    if (!this.server) return;
    const open = [...this.sessions];
    this.sessions.clear();
    this.sessionCount = 0;
    this.cancelIdleTimer();
    for (const s of open) s.abort(new Error('speech model changed'));
    const server = this.server;
    this.server = null;
    this.publishStatus();
    this.unloading = server.stop().finally(() => {
      this.unloading = null;
    });
    await this.unloading;
  }
```

Replace `this.factory(this.config.server)` in `acquire()` with `this.factory(this.serverConfigValue)`. Add the release wrapper and use it everywhere `release` was passed to a session:

```ts
  /** A session the broker already forgot (aborted during a swap) must not release twice. */
  private async releaseSession(session: AsrSession): Promise<void> {
    if (!this.sessions.delete(session)) return;
    await this.release();
  }
```

Update the file header's "What this does NOT do" list: remove the "swap = unload + load" line, since swapping is now what `setServerConfig` does.

- [ ] **Step 8: Run the broker and session tests**

Run: `yarn vitest run src/main/asr/__tests__/broker.test.ts src/main/asr/__tests__/session.test.ts src/main/asr/__tests__/ipcHandlers.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/main/asr/session.ts src/main/asr/broker.ts src/main/asr/__tests__/broker.test.ts src/main/asr/__tests__/session.test.ts
git commit -m "feat(asr): broker can swap its sidecar config, aborting open sessions"
```

---

### Task 5: Service applies a model path at runtime

**Files:**
- Modify: `src/main/asr/asrService.ts`
- Modify: `src/main/asr/__tests__/asrService.test.ts`
- Modify: `src/main/asr/index.ts`

**Interfaces:**
- Consumes: `AsrBroker.setServerConfig` (Task 4).
- Produces: `setAsrModelPath(modelPath: string | null, startTimeoutMs?: number): Promise<void>`, `getAsrModelPath(): string | null`; `AsrServiceConfig.modelStartTimeoutMs?: number`; `getAsrCapabilities()` now reflects the current path.

- [ ] **Step 1: Write the failing service tests**

Append to `src/main/asr/__tests__/asrService.test.ts`:

```ts
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
```

Add `getAsrModelPath` and `setAsrModelPath` to the test's import list.

- [ ] **Step 2: Run to verify they fail**

Run: `yarn vitest run src/main/asr/__tests__/asrService.test.ts`
Expected: FAIL, `setAsrModelPath` not exported.

- [ ] **Step 3: Restructure the service around a current model path**

Rewrite the body of `src/main/asr/asrService.ts` (keep the header comment, imports, and `AsrServiceConfig`; add `modelStartTimeoutMs?: number` to it with the doc "Readiness budget for the configured model, from the catalog."):

```ts
let broker: AsrBroker | null = null;
let initialized = false;
let serviceConfig: AsrServiceConfig | null = null;
let currentModelPath: string | null = null;
let currentStartTimeoutMs: number | undefined;
/** Readiness floor the resolved command itself needs (the nix fallback may fetch a closure first). */
let commandStartTimeoutMs: number | undefined;
/** Set when whisper-server could not be located; the broker can never exist until a restart. */
let resolveError: WhisperCommandResolveError | null = null;

export function initAsrService(config: AsrServiceConfig): AsrBroker | null {
  if (initialized) return broker;
  initialized = true;
  serviceConfig = config;
  currentModelPath = config.modelPath;
  currentStartTimeoutMs = config.modelStartTimeoutMs;
  ensureBroker();
  return broker;
}

/**
 * Build the broker if a model and a sidecar command are both available.
 * Safe to call repeatedly; a missing model is not an error here because
 * the user can download one later.
 */
function ensureBroker(): void {
  if (broker || resolveError || !serviceConfig || currentModelPath === null) return;
  try {
    const resolved = resolveWhisperServerCommand({
      binariesDir: serviceConfig.binariesDir,
      whisperServerVersion: serviceConfig.whisperServerVersion,
      isPackaged: serviceConfig.isPackaged,
    });
    commandStartTimeoutMs = resolved.startTimeoutMs;
    broker = new AsrBroker({
      server: serverConfigFor(resolved.command),
      idleTimeoutMs: serviceConfig.idleTimeoutMs,
      onStatusChange: serviceConfig.onStatusChange,
    });
  } catch (err) {
    if (err instanceof WhisperCommandResolveError) {
      resolveError = err;
      return;
    }
    throw err;
  }
}

/** The sidecar config for the current model: the larger of the command's and the model's readiness budgets. */
function serverConfigFor(command: readonly string[]): WhisperServerConfig {
  const timeouts = [commandStartTimeoutMs, currentStartTimeoutMs].filter(
    (t): t is number => t !== undefined,
  );
  return {
    command,
    modelPath: currentModelPath ?? '',
    onLog: serviceConfig?.onLog,
    startTimeoutMs: timeouts.length ? Math.max(...timeouts) : undefined,
  };
}

/**
 * Switch the model the sidecar loads. With a broker this swaps the
 * running sidecar; without one it tries to create it, so a model
 * downloaded after startup becomes usable without a restart.
 */
export async function setAsrModelPath(modelPath: string | null, startTimeoutMs?: number): Promise<void> {
  currentModelPath = modelPath;
  currentStartTimeoutMs = startTimeoutMs;
  if (broker) {
    if (modelPath === null) {
      const b = broker;
      broker = null;
      await b.destroy();
      return;
    }
    await broker.setServerConfig(serverConfigFor(broker.serverConfig.command));
    return;
  }
  ensureBroker();
}

export function getAsrModelPath(): string | null {
  return currentModelPath;
}

/** Capabilities for the model that is configured right now. Unavailable until the broker can run it. */
export function getAsrCapabilities(): LocalModelCapabilities {
  const usable = broker !== null && currentModelPath !== null;
  return computeAsrCapabilities({
    modelPath: usable ? currentModelPath : null,
    latencyTier: serviceConfig?.latencyTier,
  });
}

export function getAsrBroker(): AsrBroker {
  if (resolveError) throw resolveError;
  if (currentModelPath === null) {
    throw new Error(
      'No ASR model is installed. Download one under Settings > Services > Transcription, set $MOSS_ASR_MODEL, or bundle resources/models/' +
        BUNDLED_ASR_MODEL_FILENAME,
    );
  }
  if (!broker) {
    throw new Error('AsrBroker not initialized; call initAsrService() first');
  }
  return broker;
}

export function isAsrServiceInitialized(): boolean {
  return initialized;
}

export async function shutdownAsrService(): Promise<void> {
  const b = broker;
  resetState();
  if (b) await b.destroy();
}

export function _resetAsrServiceForTests(): void {
  resetState();
}

function resetState(): void {
  broker = null;
  initialized = false;
  serviceConfig = null;
  resolveError = null;
  currentModelPath = null;
  currentStartTimeoutMs = undefined;
  commandStartTimeoutMs = undefined;
}
```

`serverConfigFor` reads `currentModelPath`, which `setAsrModelPath` updates first, so the swap carries the new path with the same command. Import `WhisperServerConfig` from `./types`.

Existing tests in this file that assert the old "No ASR model is installed. Set $MOSS_ASR_MODEL" message still match on `/No ASR model/`; adjust any exact-string assertion to that regex.

Add `getAsrModelPath` and `setAsrModelPath` to the `asrService` export block in `src/main/asr/index.ts`.

- [ ] **Step 4: Run the service and handler tests**

Run: `yarn vitest run src/main/asr`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/asr/asrService.ts src/main/asr/__tests__/asrService.test.ts src/main/asr/index.ts
git commit -m "feat(asr): service can change the active model at runtime"
```

---

### Task 6: Model IPC handlers, wire-up, preload and renderer bridge

**Files:**
- Create: `src/main/asr/modelIpcHandlers.ts`
- Create: `src/main/asr/__tests__/modelIpcHandlers.test.ts`
- Modify: `src/main/asr/ipcHandlers.ts` (add `asrOpenSessionCount`)
- Modify: `src/main/asr/__tests__/ipcHandlers.test.ts`
- Modify: `src/main/asr/wireUp.ts`
- Modify: `src/main/index.ts:1116-1126`
- Modify: `src/preload/admin.ts` (ASR block near line 276)
- Modify: `src/renderer/src/electron-api.ts` (ASR block near line 332)
- Modify: `src/main/asr/index.ts`

**Interfaces:**
- Consumes: `AsrModelStore` (Task 2), `ModelDownloader` (Task 3), `setAsrModelPath` (Task 5), `catalogEntryById` (Task 1).
- Produces, main side:

```ts
export interface AsrModelIpcContext {
  store: AsrModelStore;
  downloader: ModelDownloader;
  applyModelPath: (modelPath: string | null, startTimeoutMs?: number) => Promise<void>;
  /** Test seam: entries to download from. Defaults to ASR_MODEL_CATALOG. */
  catalog?: readonly AsrModelCatalogEntry[];
}
export function asrModelsList(ctx): AsrModelListEntry[];
export function asrModelDownload(ctx, req: { id: string }): Promise<DownloadOutcome>;
export function asrModelCancelDownload(ctx, req: { id: string }): void;
export function asrModelDelete(ctx, req: { id: string }): Promise<void>;
export function asrModelSelect(ctx, req: { id: string }): Promise<void>;
export function asrOpenSessionCount(ctx: AsrIpcHandlerContext): number;   // in ipcHandlers.ts
```

- Produces, renderer side (`window.electronAPI`):

```ts
asrModelsList: () => Promise<AsrModelListEntry[]>;
asrModelDownload: (req: { id: string }) => Promise<'complete' | 'cancelled'>;
asrModelCancelDownload: (req: { id: string }) => Promise<void>;
asrModelDelete: (req: { id: string }) => Promise<void>;
asrModelSelect: (req: { id: string }) => Promise<void>;
asrOpenSessionCount: () => Promise<number>;
onAsrModelDownloadProgress: (callback: (e: Electron.IpcRendererEvent, p: DownloadProgress) => void) => void;
```

Channels: `asr-models-list`, `asr-model-download`, `asr-model-cancel-download`, `asr-model-delete`, `asr-model-select`, `asr-open-session-count`, push `asr-model-download-progress`.

Preload and renderer import `AsrModelListEntry` and `AsrModelDownloadProgress` from `@theweave/moss-types` (Task 1); both files already import other types from that package.

- [ ] **Step 1: Write the failing handler tests**

```ts
// src/main/asr/__tests__/modelIpcHandlers.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModelDownloader } from '../modelDownloader';
import {
  type AsrModelIpcContext,
  asrModelCancelDownload,
  asrModelDelete,
  asrModelDownload,
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
```

Add these imports at the top of the test: `import { createHash } from 'node:crypto';` and `import { type AsrModelCatalogEntry, catalogEntryById } from '../modelCatalog';`. The start budget passed to `applyModelPath` comes from the real catalog (via `catalogEntryForPath` in `applyResolved`), which is why it is tiny's real 120 000 ms and not derived from the 3-byte fake.

- [ ] **Step 2: Run to verify they fail**

Run: `yarn vitest run src/main/asr/__tests__/modelIpcHandlers.test.ts`
Expected: FAIL, cannot resolve `../modelIpcHandlers`.

- [ ] **Step 3: Write the handlers**

```ts
// src/main/asr/modelIpcHandlers.ts
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
```

Add to `ipcHandlers.ts`:

```ts
/** How many tool sessions are open right now; 0 when no broker could be created. */
export function asrOpenSessionCount(ctx: AsrIpcHandlerContext): number {
  try {
    return ctx.getBroker().openSessionCount;
  } catch {
    return 0;
  }
}
```

and a test in `ipcHandlers.test.ts`:

```ts
  it('asrOpenSessionCount reports open sessions and 0 without a broker', async () => {
    const h = makeHarness();
    expect(asrOpenSessionCount(h.ctx)).toBe(0);
    await asrOpenSession(h.ctx, 1, {});
    expect(asrOpenSessionCount(h.ctx)).toBe(1);
    const broken: AsrIpcHandlerContext = { ...h.ctx, getBroker: () => { throw new Error('none'); } };
    expect(asrOpenSessionCount(broken)).toBe(0);
  });
```

Export from `src/main/asr/index.ts`:

```ts
export {
  asrModelCancelDownload,
  asrModelDelete,
  asrModelDownload,
  asrModelSelect,
  asrModelsList,
} from './modelIpcHandlers';
export type { AsrModelIdRequest, AsrModelIpcContext } from './modelIpcHandlers';
```

and add `asrOpenSessionCount` to the `ipcHandlers` export block.

- [ ] **Step 4: Run the handler tests**

Run: `yarn vitest run src/main/asr/__tests__/modelIpcHandlers.test.ts src/main/asr/__tests__/ipcHandlers.test.ts src/main/asr/__tests__/modelStore.test.ts src/main/asr/__tests__/modelDownloader.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the wire-up**

In `src/main/asr/wireUp.ts`:

- Replace `defaultModelPath` in the imports with `getAsrCapabilities, getAsrBroker, initAsrService, setAsrModelPath, shutdownAsrService`.
- Import `AsrModelStore` from `./modelStore`, `ModelDownloader` from `./modelDownloader`, `catalogEntryForPath` from `./modelCatalog`, the five model handlers plus `AsrModelIpcContext` from `./modelIpcHandlers`, and `asrOpenSessionCount` from `./ipcHandlers`.
- Change `AsrWireUpConfig`: drop `modelPath` and `repoRoot`; add

```ts
  /** <profileDataDir>/models: where downloaded models go. */
  modelsDir: string;
  /** <profileConfigDir>: holds the user's model choice. */
  configDir: string;
  /** Repo root, for the dev-only spike model directory. */
  repoRoot?: string;
```

- In `registerAsrIpc`, before `initAsrService`:

```ts
  const store = new AsrModelStore({
    modelsDir: config.modelsDir,
    configDir: config.configDir,
    bundledModelsDir: config.resourcesPath ? path.join(config.resourcesPath, 'models') : undefined,
    spikeModelsDir: config.repoRoot ? path.join(config.repoRoot, 'spikes/asr-m0/models') : undefined,
  });
  const modelPath = store.resolveActiveModelPath();
  const modelEntry = modelPath ? catalogEntryForPath(modelPath) : undefined;
```

pass `modelPath` and `modelStartTimeoutMs: modelEntry?.startTimeoutMs` to `initAsrService`, and after it:

```ts
  const broadcast = (channel: string, payload: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(channel, payload);
    }
  };
  const modelCtx: AsrModelIpcContext = {
    store,
    downloader: new ModelDownloader({
      modelsDir: store.modelsDir,
      onProgress: (p) => broadcast('asr-model-download-progress', p),
    }),
    applyModelPath: setAsrModelPath,
  };

  ipcMain.handle('asr-models-list', () => asrModelsList(modelCtx));
  ipcMain.handle('asr-model-download', (_e, req: { id: string }) => asrModelDownload(modelCtx, req));
  ipcMain.handle('asr-model-cancel-download', (_e, req: { id: string }) => asrModelCancelDownload(modelCtx, req));
  ipcMain.handle('asr-model-delete', (_e, req: { id: string }) => asrModelDelete(modelCtx, req));
  ipcMain.handle('asr-model-select', (_e, req: { id: string }) => asrModelSelect(modelCtx, req));
  ipcMain.handle('asr-open-session-count', () => asrOpenSessionCount(ctx));
```

Use `broadcast('asr-status', status)` for the existing `onStatusChange` too. Add `import path from 'node:path';`. Update the header comment's "Registers" list.

- [ ] **Step 6: Update the caller, preload and renderer bridge**

`src/main/index.ts` (the `registerAsrIpc` call):

```ts
    registerAsrIpc({
      binariesDir: BINARIES_DIRECTORY,
      resourcesPath: RESOURCES_DIRECTORY,
      whisperServerVersion: MOSS_CONFIG.whisperServer,
      modelsDir: WE_FILE_SYSTEM.modelsDir,
      configDir: WE_FILE_SYSTEM.profileConfigDir,
      repoRoot: app.getAppPath(),
      onLog: ...unchanged...
    });
```

`src/preload/admin.ts`: add `AsrModelDownloadProgress, AsrModelListEntry` to the existing `from '@theweave/moss-types'` import, and after `asrCloseSession`:

```ts
  asrModelsList: () => ipcRenderer.invoke('asr-models-list') as Promise<AsrModelListEntry[]>,
  asrModelDownload: (req: { id: string }) =>
    ipcRenderer.invoke('asr-model-download', req) as Promise<'complete' | 'cancelled'>,
  asrModelCancelDownload: (req: { id: string }) =>
    ipcRenderer.invoke('asr-model-cancel-download', req) as Promise<void>,
  asrModelDelete: (req: { id: string }) => ipcRenderer.invoke('asr-model-delete', req) as Promise<void>,
  asrModelSelect: (req: { id: string }) => ipcRenderer.invoke('asr-model-select', req) as Promise<void>,
  asrOpenSessionCount: () => ipcRenderer.invoke('asr-open-session-count') as Promise<number>,
  onAsrModelDownloadProgress: (
    callback: (e: Electron.IpcRendererEvent, p: AsrModelDownloadProgress) => void,
  ) => ipcRenderer.on('asr-model-download-progress', callback),
```

`src/renderer/src/electron-api.ts`: add the same two types to its existing `from '@theweave/moss-types'` import, and add the matching signatures after `asrCloseSession` in the `electronAPI` interface.

- [ ] **Step 7: Typecheck and run the whole asr suite plus the drift test**

Run: `yarn typecheck && yarn vitest run src/main/asr src/main/ipc-contract-drift.test.ts`
Expected: PASS. A drift failure names a channel that is invoked without a handler or vice versa; the six invoke channels above must each appear in both files.

- [ ] **Step 8: Commit**

```bash
git add src/main/asr src/main/index.ts src/preload/admin.ts src/renderer/src/electron-api.ts
git commit -m "feat(asr): IPC surface for listing, downloading, deleting and selecting models"
```

---

### Task 7: Settings UI with a model list and a swap confirmation

**Files:**
- Create: `src/renderer/src/self/settings/services/model-row-state.ts`
- Create: `src/renderer/src/self/settings/services/model-row-state.test.ts`
- Create: `src/renderer/src/self/settings/services/asr-model-list.ts`
- Modify: `src/renderer/src/self/settings/services/transcription-settings.ts`
- Modify: `src/renderer/xliff/*.xlf`, `src/renderer/src/locales/generated/*` (via the i18n scripts)

**Interfaces:**
- Consumes: `window.electronAPI.asrModelsList/asrModelDownload/asrModelCancelDownload/asrModelDelete/asrModelSelect/asrOpenSessionCount/onAsrModelDownloadProgress` (Task 6); `AsrModelListEntry`, `AsrModelDownloadProgress` from `@theweave/moss-types` (Task 1).
- Produces:

```ts
// model-row-state.ts
export type ModelRowState =
  | { kind: 'download' }
  | { kind: 'resume'; partialBytes: number }
  | { kind: 'downloading'; percent: number }
  | { kind: 'installed'; deletable: boolean }
  | { kind: 'active'; deletable: boolean };
export function modelRowState(entry: AsrModelListEntry, progress: AsrModelDownloadProgress | undefined): ModelRowState;
export function formatModelSize(bytes: number): string;   // '142 MB', '1.5 GB'
export function isEnglishOnly(languages: readonly string[]): boolean;
// asr-model-list.ts: <asr-model-list .models .progress .errors> dispatching
//   CustomEvent<{ id: string }> named 'model-download' | 'model-cancel' | 'model-delete' | 'model-select'
```

- [ ] **Step 1: Write the failing row-state test**

```ts
// src/renderer/src/self/settings/services/model-row-state.test.ts
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

  it('offers Resume when a partial file exists', () => {
    expect(modelRowState(entry({ partialBytes: 1234 }), undefined)).toEqual({ kind: 'resume', partialBytes: 1234 });
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn vitest run src/renderer/src/self/settings/services/model-row-state.test.ts`
Expected: FAIL, cannot resolve `./model-row-state.js`.

- [ ] **Step 3: Write the row-state module**

```ts
// src/renderer/src/self/settings/services/model-row-state.ts
// Pure presentation logic for one row of the speech-model list, kept out
// of the Lit element so it can be unit-tested without a DOM.

import type { AsrModelDownloadProgress, AsrModelListEntry } from '@theweave/moss-types';

export type ModelRowState =
  | { kind: 'download' }
  | { kind: 'resume'; partialBytes: number }
  | { kind: 'downloading'; percent: number }
  | { kind: 'installed'; deletable: boolean }
  | { kind: 'active'; deletable: boolean };

export function modelRowState(
  entry: AsrModelListEntry,
  progress: AsrModelDownloadProgress | undefined,
): ModelRowState {
  if (progress) {
    const percent = progress.total > 0 ? Math.floor((100 * progress.bytes) / progress.total) : 0;
    return { kind: 'downloading', percent };
  }
  if (entry.installed) {
    // The bundled copy is read-only; only a downloaded model can be removed.
    const deletable = !entry.bundled;
    return entry.active ? { kind: 'active', deletable } : { kind: 'installed', deletable };
  }
  if (entry.partialBytes !== undefined) return { kind: 'resume', partialBytes: entry.partialBytes };
  return { kind: 'download' };
}

export function formatModelSize(bytes: number): string {
  const GB = 1_000_000_000;
  const MB = 1_000_000;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  return `${Math.round(bytes / MB)} MB`;
}

export function isEnglishOnly(languages: readonly string[]): boolean {
  return languages.length === 1 && languages[0] === 'en';
}
```

- [ ] **Step 4: Run the row-state test**

Run: `yarn vitest run src/renderer/src/self/settings/services/model-row-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the list element**

```ts
// src/renderer/src/self/settings/services/asr-model-list.ts
// The speech-model table under Settings > Services > Transcription. Dumb
// by design: it renders what it is given and asks its host to act, so the
// host owns IPC, confirmation and refresh.

import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/progress-bar/progress-bar.js';

import type { AsrModelDownloadProgress, AsrModelListEntry } from '@theweave/moss-types';
import { mossStyles } from '../../../shared-styles.js';
import { serviceStyles } from './service-styles.js';
import { formatModelSize, isEnglishOnly, modelRowState } from './model-row-state.js';

export type AsrModelListAction = 'model-download' | 'model-cancel' | 'model-delete' | 'model-select';

@localized()
@customElement('asr-model-list')
export class AsrModelList extends LitElement {
  @property({ attribute: false }) models: AsrModelListEntry[] = [];
  @property({ attribute: false }) progress: ReadonlyMap<string, AsrModelDownloadProgress> = new Map();
  @property({ attribute: false }) errors: ReadonlyMap<string, string> = new Map();

  private act(action: AsrModelListAction, id: string): void {
    this.dispatchEvent(new CustomEvent<{ id: string }>(action, { detail: { id }, bubbles: true, composed: true }));
  }

  private renderControls(entry: AsrModelListEntry) {
    const state = modelRowState(entry, this.progress.get(entry.id));
    switch (state.kind) {
      case 'download':
        return html`<sl-button size="small" @click=${() => this.act('model-download', entry.id)}>${msg('Download')}</sl-button>`;
      case 'resume':
        return html`<sl-button size="small" @click=${() => this.act('model-download', entry.id)}>${msg('Resume')}</sl-button>`;
      case 'downloading':
        return html`
          <sl-progress-bar value=${state.percent}>${state.percent}%</sl-progress-bar>
          <sl-button size="small" @click=${() => this.act('model-cancel', entry.id)}>${msg('Cancel')}</sl-button>
        `;
      case 'installed':
        return html`
          <sl-button size="small" variant="primary" @click=${() => this.act('model-select', entry.id)}>${msg('Use')}</sl-button>
          ${state.deletable
            ? html`<sl-button size="small" @click=${() => this.act('model-delete', entry.id)}>${msg('Delete')}</sl-button>`
            : nothing}
        `;
      case 'active':
        return html`
          <span class="active-badge">${msg('Active')}</span>
          ${state.deletable
            ? html`<sl-button size="small" @click=${() => this.act('model-delete', entry.id)}>${msg('Delete')}</sl-button>`
            : nothing}
        `;
    }
  }

  render() {
    return html`
      <div class="column service-rows">
        ${this.models.map(
          (entry) => html`
            <div class="row service-row">
              <div class="column" style="flex: 1; min-width: 0;">
                <span class="service-row-name">${entry.id}${entry.bundled ? html` · ${msg('Bundled')}` : nothing}</span>
                <span class="service-row-meta">
                  ${formatModelSize(entry.sizeBytes)} ·
                  ${isEnglishOnly(entry.languages) ? msg('English only') : msg('Multilingual')}
                </span>
                ${this.errors.has(entry.id)
                  ? html`<span class="service-error">${this.errors.get(entry.id)}</span>`
                  : nothing}
              </div>
              <div class="row controls">${this.renderControls(entry)}</div>
            </div>
          `,
        )}
      </div>
    `;
  }

  static styles = [
    mossStyles,
    serviceStyles,
    css`
      :host {
        display: block;
      }
      .controls {
        align-items: center;
        gap: 8px;
      }
      sl-progress-bar {
        width: 140px;
        --height: 16px;
      }
      .active-badge {
        font-size: 12px;
        font-weight: 600;
        color: var(--moss-purple, #6200ea);
      }
      .service-error {
        font-size: 12px;
        color: var(--sl-color-danger-600, #b00020);
      }
    `,
  ];
}
```

- [ ] **Step 6: Wire the list into the transcription pane with a swap confirmation**

In `src/renderer/src/self/settings/services/transcription-settings.ts`:

Imports to add:

```ts
import { str } from '@lit/localize';  // merge into the existing @lit/localize import
import './asr-model-list.js';
import type { AsrModelDownloadProgress, AsrModelListEntry } from '@theweave/moss-types';
```

State and listeners:

```ts
  @state() private models: AsrModelListEntry[] = [];
  @state() private progress: Map<string, AsrModelDownloadProgress> = new Map();
  @state() private modelErrors: Map<string, string> = new Map();
  @state() private pendingSwitch: { id: string; sessions: number } | null = null;

  @query('#switch-dialog')
  private _switchDialog!: MossDialog;

  private onDownloadProgress = (_e: Electron.IpcRendererEvent, p: AsrModelDownloadProgress) => {
    const next = new Map(this.progress);
    next.set(p.id, p);
    this.progress = next;
  };
```

In `connectedCallback`, after the existing listener: `window.electronAPI.onAsrModelDownloadProgress(this.onDownloadProgress);` (the preload's `ipcRenderer.on` has no matching off; the pane is long-lived, and a second mount only adds a duplicate progress write of the same value). Extend `refresh()` to also call `this.refreshModels()`:

```ts
  private async refreshModels(): Promise<void> {
    try {
      this.models = await window.electronAPI.asrModelsList();
    } catch (e) {
      this.capabilitiesError = (e as Error).message;
    }
  }

  private setModelError(id: string, message: string | null): void {
    const next = new Map(this.modelErrors);
    if (message === null) next.delete(id);
    else next.set(id, message);
    this.modelErrors = next;
  }

  private clearProgress(id: string): void {
    const next = new Map(this.progress);
    next.delete(id);
    this.progress = next;
  }

  private async downloadModel(id: string): Promise<void> {
    this.setModelError(id, null);
    try {
      await window.electronAPI.asrModelDownload({ id });
    } catch (e) {
      this.setModelError(id, (e as Error).message);
    } finally {
      this.clearProgress(id);
      await Promise.all([this.refreshModels(), this.refreshCapabilities()]);
    }
  }

  private async cancelDownload(id: string): Promise<void> {
    await window.electronAPI.asrModelCancelDownload({ id });
  }

  private async deleteModel(id: string): Promise<void> {
    this.setModelError(id, null);
    try {
      await window.electronAPI.asrModelDelete({ id });
    } catch (e) {
      this.setModelError(id, (e as Error).message);
    }
    await Promise.all([this.refreshModels(), this.refreshCapabilities()]);
  }

  /** Switching stops every open tool session, so ask first when there are any. */
  private async requestSelect(id: string): Promise<void> {
    const sessions = await window.electronAPI.asrOpenSessionCount();
    if (sessions > 0) {
      this.pendingSwitch = { id, sessions };
      await this.updateComplete;
      this._switchDialog.show();
      return;
    }
    await this.selectModel(id);
  }

  private async confirmSwitch(): Promise<void> {
    const pending = this.pendingSwitch;
    this.pendingSwitch = null;
    this._switchDialog.hide();
    if (pending) await this.selectModel(pending.id);
  }

  private async selectModel(id: string): Promise<void> {
    this.setModelError(id, null);
    try {
      await window.electronAPI.asrModelSelect({ id });
    } catch (e) {
      this.setModelError(id, (e as Error).message);
    }
    await Promise.all([this.refreshModels(), this.refreshCapabilities()]);
  }
```

Add a section to `render()` between "Speech recognition" and "Tool permissions":

```ts
        <section>
          <h3 style="margin: 0 0 8px 0;">${msg('Model')}</h3>
          <p class="service-note" style="margin: 0 0 8px 0;">
            ${msg('Choose which speech model Moss runs. Larger models are more accurate but slower and use more memory.')}
          </p>
          <asr-model-list
            .models=${this.models}
            .progress=${this.progress}
            .errors=${this.modelErrors}
            @model-download=${(e: CustomEvent<{ id: string }>) => void this.downloadModel(e.detail.id)}
            @model-cancel=${(e: CustomEvent<{ id: string }>) => void this.cancelDownload(e.detail.id)}
            @model-delete=${(e: CustomEvent<{ id: string }>) => void this.deleteModel(e.detail.id)}
            @model-select=${(e: CustomEvent<{ id: string }>) => void this.requestSelect(e.detail.id)}
          ></asr-model-list>
        </section>
```

and the dialog next to the about dialog in the template (`${this.renderSwitchDialog()}`):

```ts
  private renderSwitchDialog() {
    const n = this.pendingSwitch?.sessions ?? 0;
    return html`
      <moss-dialog id="switch-dialog" width="520px" headerAlign="left">
        <span slot="header">${msg('Switch speech model?')}</span>
        <div slot="content" class="column" style="gap: 16px;">
          <p>
            ${msg(
              str`${n} transcription session(s) are active. Switching the model stops them now. Tools will need to start transcription again, for example by rejoining a room.`,
            )}
          </p>
          <div class="row" style="justify-content: flex-end; gap: 8px;">
            <sl-button @click=${() => { this.pendingSwitch = null; this._switchDialog.hide(); }}>${msg('Cancel')}</sl-button>
            <sl-button variant="primary" @click=${() => void this.confirmSwitch()}>${msg('Switch')}</sl-button>
          </div>
        </div>
      </moss-dialog>
    `;
  }
```

Update the file's header comment to list the model section.

- [ ] **Step 7: Extract, translate and build the strings**

Run: `yarn i18n:extract`

New `<trans-unit>` entries appear in each `src/renderer/xliff/*.xlf` with empty `<target>`. Fill them (`Cancel` and `Delete` already exist with translations; do not duplicate):

| English | de | fr | es | tr | it | pt | ja | nl |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Model | Modell | Modèle | Modelo | Model | Modello | Modelo | モデル | Model |
| Choose which speech model Moss runs. Larger models are more accurate but slower and use more memory. | Wähle, welches Sprachmodell Moss ausführt. Größere Modelle sind genauer, aber langsamer und brauchen mehr Speicher. | Choisissez le modèle vocal que Moss exécute. Les modèles plus grands sont plus précis mais plus lents et utilisent plus de mémoire. | Elige qué modelo de voz ejecuta Moss. Los modelos más grandes son más precisos pero más lentos y usan más memoria. | Moss'un hangi konuşma modelini çalıştıracağını seçin. Büyük modeller daha doğru ama daha yavaştır ve daha fazla bellek kullanır. | Scegli quale modello vocale esegue Moss. I modelli più grandi sono più precisi ma più lenti e usano più memoria. | Escolha qual modelo de voz o Moss executa. Modelos maiores são mais precisos, mas mais lentos e usam mais memória. | Moss が実行する音声モデルを選びます。大きいモデルは精度が高いものの、遅くメモリを多く使います。 | Kies welk spraakmodel Moss gebruikt. Grotere modellen zijn nauwkeuriger maar trager en gebruiken meer geheugen. |
| Download | Herunterladen | Télécharger | Descargar | İndir | Scarica | Baixar | ダウンロード | Downloaden |
| Resume | Fortsetzen | Reprendre | Reanudar | Devam et | Riprendi | Retomar | 再開 | Hervatten |
| Use | Verwenden | Utiliser | Usar | Kullan | Usa | Usar | 使用 | Gebruiken |
| Active | Aktiv | Actif | Activo | Etkin | Attivo | Ativo | 使用中 | Actief |
| Bundled | Mitgeliefert | Inclus | Incluido | Dahil | Incluso | Incluído | 同梱 | Meegeleverd |
| English only | Nur Englisch | Anglais uniquement | Solo inglés | Yalnızca İngilizce | Solo inglese | Somente inglês | 英語のみ | Alleen Engels |
| Multilingual | Mehrsprachig | Multilingue | Multilingüe | Çok dilli | Multilingue | Multilíngue | 多言語 | Meertalig |
| Switch speech model? | Sprachmodell wechseln? | Changer de modèle vocal ? | ¿Cambiar el modelo de voz? | Konuşma modeli değiştirilsin mi? | Cambiare modello vocale? | Trocar o modelo de voz? | 音声モデルを切り替えますか？ | Spraakmodel wisselen? |
| `${n}` transcription session(s) are active. Switching the model stops them now. Tools will need to start transcription again, for example by rejoining a room. | `${n}` Transkriptionssitzung(en) sind aktiv. Ein Modellwechsel beendet sie sofort. Tools müssen die Transkription neu starten, zum Beispiel durch erneutes Betreten eines Raums. | `${n}` session(s) de transcription sont actives. Changer de modèle les arrête maintenant. Les outils devront relancer la transcription, par exemple en rejoignant à nouveau une salle. | `${n}` sesión(es) de transcripción están activas. Cambiar el modelo las detiene ahora. Las herramientas tendrán que reiniciar la transcripción, por ejemplo volviendo a entrar en una sala. | `${n}` transkripsiyon oturumu etkin. Modeli değiştirmek bunları hemen durdurur. Araçların transkripsiyonu yeniden başlatması gerekir, örneğin bir odaya yeniden katılarak. | `${n}` sessione/i di trascrizione attive. Cambiare modello le interrompe subito. Gli strumenti dovranno riavviare la trascrizione, ad esempio rientrando in una stanza. | `${n}` sessão(ões) de transcrição estão ativas. Trocar o modelo as interrompe agora. As ferramentas precisarão reiniciar a transcrição, por exemplo entrando novamente em uma sala. | `${n}` 件の文字起こしセッションが進行中です。モデルを切り替えると今すぐ停止します。ツール側で文字起こしを再開する必要があります（例: ルームに再参加）。 | `${n}` transcriptiesessie(s) zijn actief. Van model wisselen stopt ze nu. Tools moeten de transcriptie opnieuw starten, bijvoorbeeld door een ruimte opnieuw te betreden. |
| Switch | Wechseln | Changer | Cambiar | Değiştir | Cambia | Trocar | 切り替える | Wisselen |

In the XLIFF the `${n}` placeholder appears as an `<x>` element inside `<source>`; copy that element verbatim into `<target>` at the right position.

Run: `yarn i18n:build`

- [ ] **Step 8: Typecheck and run the unit suite**

Run: `yarn typecheck && yarn test:unit`
Expected: typecheck clean; all tests pass except the two pre-existing `lanBeacon/socket.test.ts` cases.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/self/settings/services src/renderer/xliff src/renderer/src/locales/generated
git commit -m "feat(settings): download, choose and delete speech models under Transcription"
```

---

### Task 8: Manual run and docs touch

**Files:**
- Modify: `docs/build/transcription.md` (one paragraph)

- [ ] **Step 1: Document the setting for tool authors**

Add a short paragraph to `docs/build/transcription.md` under the section that describes `capabilities()`:

> The user picks the speech model under Settings > Services > Transcription. `capabilities().asr.model`, `languages` and `latencyTier` describe whichever model is active. When the user switches models while your session is open, the session ends with an `onError` whose message is `speech model changed`; open a new session to continue.

- [ ] **Step 2: Smoke-test in the app**

From the worktree, with `resources/bins`, `resources/models/ggml-base.en.bin` and `resources/default-apps` symlinked from the main checkout the way the `ai-transcription` worktree does it (see that worktree's setup), run `yarn applet-dev-example-1`, open Settings > Services > Transcription and confirm: the list shows ten rows with base.en marked Bundled and Active; Download on tiny.en shows a progress bar and ends Installed; Use switches the Active badge and the about dialog's technical details show `tiny.en`; Delete removes it and the badge returns to base.en. If the example applet has a transcription session open, Use shows the confirmation dialog first.

Record anything that did not behave as described in the commit message of the fix, not in this plan.

- [ ] **Step 3: Commit**

```bash
git add docs/build/transcription.md
git commit -m "docs: how the user-chosen speech model reaches tools"
```

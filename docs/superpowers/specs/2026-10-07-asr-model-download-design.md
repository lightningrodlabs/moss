# In-app whisper model download and selection

Date: 2026-10-07. Branch: `feat/asr-model-download` off `main-0.7`.

## Goal

Let a Moss user download whisper speech models from Settings > Services >
Transcription and choose which one is active. The chosen model is the one
model that every tool gets. Tools learn about it only through the existing
`capabilities()` fields (`model`, `languages`, `latencyTier`). There is no
change to `@theweave/api`.

Out of scope: tool-facing model choice, a model list in `capabilities()`,
`utilityProcess` isolation of the sidecar, and dropping the bundled
`ggml-base.en.bin` from the installer.

## Current state

The model is one path resolved once at startup (`defaultModelPath` in
`src/main/asr/asrService.ts`): `$MOSS_ASR_MODEL`, then
`<resources>/models/ggml-base.en.bin`, then the spike path. `initAsrService`
bakes the path into the broker's `WhisperServerConfig`, whisper-server is
launched with `-m <path>`, and capabilities are computed once from the file
name and cached for the life of the app. The only download code is the
build-time script `scripts/fetch-asr-model.mjs`.

## Components

All new main-process modules live in `src/main/asr/`, are plain Node (no
`electron` import), and take their paths and I/O as parameters so vitest can
cover them without Electron. `wireUp.ts` stays the only Electron-aware file.

### Catalog: `modelCatalog.ts`

A fixed, checked-in list of ggml whisper models published at
`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/<filename>`:
tiny, tiny.en, base, base.en, small, small.en, medium, medium.en,
large-v3-turbo, large-v3.

```ts
export interface AsrModelCatalogEntry {
  id: string;            // 'base.en'
  filename: string;      // 'ggml-base.en.bin'
  url: string;
  sha256: string;        // from the HuggingFace LFS pointer file
  sizeBytes: number;
  languages: readonly string[];   // ['en'] or WHISPER_MULTILINGUAL_CODES
  latencyTier: 'fast' | 'ok' | 'slow';
  startTimeoutMs: number;         // scaled with size; large-v3 needs minutes on a cold cache
}
export const ASR_MODEL_CATALOG: readonly AsrModelCatalogEntry[];
export function catalogEntryById(id: string): AsrModelCatalogEntry | undefined;
export function catalogEntryForPath(p: string): AsrModelCatalogEntry | undefined; // by basename
```

The sha256 and size values are copied from the LFS pointer files
(`https://huggingface.co/ggerganov/whisper.cpp/raw/main/<filename>`) when
the catalog is written; a unit test checks each entry is well formed (64 hex
chars, positive size, filename matches id). `WHISPER_MULTILINGUAL_CODES`
moves from `capabilities.ts` into the catalog module.

`computeAsrCapabilities` uses the catalog entry for the active path when one
matches by basename, and keeps the filename parse only as a fallback for
`$MOSS_ASR_MODEL` overrides that point at files not in the catalog.

### Store: `modelStore.ts`

Knows where models live and which one is active.

- Downloaded models go in `<profileDataDir>/models/`, a new `modelsDir` on
  `MossFileSystem` (`src/main/filesystem.ts`), created with the other
  profile directories.
- The user's choice is saved as `<profileConfigDir>/asr-model.json`
  (`{ "modelId": "small" }`), a small JSON file read with a try/catch so a
  missing or damaged file reads as no choice.
- The row and progress shapes that cross to the renderer
  (`AsrModelListEntry`, `AsrModelDownloadProgress`, `AsrLatencyTier`) live
  in `@theweave/moss-types` (`shared/types/src/asr-models.ts`), which main,
  preload and renderer already import.
- `listModels(dirs)` returns one `AsrModelListEntry` per catalog entry:

```ts
export interface AsrModelListEntry {
  id: string;
  sizeBytes: number;
  languages: readonly string[];
  latencyTier: 'fast' | 'ok' | 'slow';
  installed: boolean;   // complete file in modelsDir, or bundled
  bundled: boolean;     // shipped in <resources>/models; cannot be deleted
  active: boolean;
  partialBytes?: number; // size of a leftover .part file, for "Resume"
}
```

- `resolveActiveModelPath(dirs, env)` replaces `defaultModelPath`. Order:
  `$MOSS_ASR_MODEL`; the saved choice when its file is installed; the
  bundled `ggml-base.en.bin`; the spike path; else `null`.
- `deleteModel(id)` removes the downloaded file and any `.part`. The bundled
  model cannot be deleted. Deleting the active model clears the saved
  choice, so resolution falls back to the bundled model.

### Downloader: `modelDownloader.ts`

```ts
export interface DownloadProgress { id: string; bytes: number; total: number }
export type DownloadOutcome = 'complete' | 'cancelled';
export class ModelDownloader {
  constructor(opts: { modelsDir: string; fetch?: typeof fetch; onProgress: (p: DownloadProgress) => void });
  download(entry: AsrModelCatalogEntry): Promise<DownloadOutcome>;
  cancel(id: string): void;
  isDownloading(id: string): boolean;
}
```

- One in-flight download per model id; a second `download()` for the same id
  returns the in-flight promise.
- Streams the body to `<filename>.part`. When a `.part` exists, sends
  `Range: bytes=<size>-` and appends on a 206; on a 200 it truncates and
  starts over.
- Progress is reported at most every 250 ms and on completion.
- `cancel()` aborts the fetch through an `AbortController`, keeps the
  `.part` for a later resume, and resolves the promise with `'cancelled'`.
- On completion it streams the file through sha256. A mismatch deletes the
  file and rejects with a clear error. A match renames `.part` to the final
  name.
- Network and HTTP errors reject with the status or cause in the message;
  the `.part` stays for resume.

### Broker swap: `broker.ts`

`AsrBroker` gains:

```ts
setServerConfig(next: WhisperServerConfig): Promise<void>;
```

If no server is loaded or starting, it just replaces the stored config. If a
server is loaded, it closes every open session (each gets its `onError`
with "model changed"), stops the server, clears the idle timer, replaces the
config, and publishes status `idle`. The next `acquire()` cold-starts with
the new model. A start that is in flight is awaited and then stopped the
same way.

To close sessions the broker must know them, so `openSession()` records the
session in a set and the release callback removes it. `openSessionCount`
already exists.

### Service: `asrService.ts`

- `initAsrService` takes the resolved path from the store and no longer
  caches capabilities for the life of the app: `getAsrCapabilities()`
  recomputes from the current path.
- New `setAsrModelPath(path, startTimeoutMs?)`: records the path, swaps
  the running broker's config (`broker.setServerConfig`), or creates the
  broker if init had no model, or destroys it when the path is null.
- When init found no whisper-server binary, the path is still recorded and
  the resolver error is still what `getAsrBroker()` throws, so the setting
  survives a later fix.
- The store-facing steps (write the selection, resolve the path, look up
  the catalog start budget) live in the handlers, `modelIpcHandlers.ts`,
  which call `setAsrModelPath` through the context's `applyModelPath`.

### IPC: `modelIpcHandlers.ts`, `ipcHandlers.ts` and `wireUp.ts`

New channels, each a literal string so `ipc-contract-drift.test.ts` sees
them:

| channel | direction | payload |
| --- | --- | --- |
| `asr-models-list` | invoke | → `AsrModelListEntry[]` |
| `asr-model-download` | invoke | `{ id }` → `DownloadOutcome` (resolves when the download ends; when no model was active before, the completed download becomes the active model) |
| `asr-model-cancel-download` | invoke | `{ id }` |
| `asr-model-delete` | invoke | `{ id }` |
| `asr-model-select` | invoke | `{ id }` |
| `asr-open-session-count` | invoke | → `number` |
| `asr-model-download-progress` | push to all windows | `DownloadProgress` |

`wireUp.ts` builds the store and downloader from `MossFileSystem` paths
passed in `AsrWireUpConfig` (`modelsDir`, `configDir`) and broadcasts
progress the way it broadcasts `asr-status`. `preload/admin.ts` and
`src/renderer/src/electron-api.ts` gain matching methods and an
`onAsrModelDownloadProgress` subscription.

### Settings UI

`transcription-settings.ts` gets a "Model" section that renders a new
element `asr-model-list.ts` in the same directory. The list shows one row
per catalog entry: name, size, language summary ("English only" or
"Multilingual"), and a state column:

- not installed: Download button (labelled Resume when `partialBytes` is set)
- downloading: progress bar with percent, Cancel button
- installed, not active: Use button, Delete button (hidden when bundled)
- installed and active: "Active" badge

Errors from a download or hash mismatch show inline in the row.

Selecting a model when `asr-open-session-count` is greater than zero opens
a `moss-dialog` confirm: "N transcription sessions are active. Switching
the model stops them now. Tools will need to start transcription again, for
example by rejoining a room. Switch anyway?" with Cancel and Switch. When
the count is zero the switch happens without a dialog. The about dialog's
technical details already show the active model and languages and need no
change.

All new strings go through `msg()` and the lit-localize extract and build
steps.

## Data flow

Download: renderer invokes `asr-model-download` → handler calls
`downloader.download(entry)` → progress pushes `asr-model-download-progress`
→ renderer updates the row → invoke resolves → renderer refreshes the list.

Select: renderer checks `asr-open-session-count`, maybe confirms, invokes
`asr-model-select` → `selectAsrModel` saves the choice and calls
`broker.setServerConfig` → sessions close (tools get `onError`) → status
`idle` broadcasts → next `openSession` or `warmUp` loads the new model →
`capabilities()` reports it.

Startup: `registerAsrIpc` resolves the active path through the store so a
saved choice is honored across restarts.

## Error handling

- Download failures keep the `.part` and surface the message in the row;
  the user can retry.
- A hash mismatch deletes the file and reports it; retry downloads afresh.
- Selecting an id that is not installed rejects.
- Deleting the active model falls back to bundled and recomputes
  capabilities; the broker swaps if loaded.
- If the broker was never created (no binary), select and delete still
  update the saved choice and capabilities.

## Testing

Vitest unit tests, no Holochain, no Electron:

- `modelCatalog.test.ts`: every entry well formed; lookup by id and path.
- `modelStore.test.ts`: listing against fixture directories (bundled only,
  downloaded, `.part` present); resolution order; delete rules; saved
  choice round trip and damaged file.
- `modelDownloader.test.ts` with a fake `fetch`: fresh download, resume on
  206, restart on 200, cancel keeps `.part`, bad hash deletes, progress
  throttling, one in-flight per id.
- `broker.test.ts`: `setServerConfig` with no server, with a loaded server
  (sessions closed, server stopped, next acquire uses new config), with a
  start in flight.
- `asrService.test.ts`: `selectAsrModel` updates capabilities and the saved
  choice; works without a broker.
- `ipcHandlers.test.ts`: the new handlers against fakes.
- `capabilities.test.ts`: catalog entry wins over filename parse.
- Renderer: the unit suite runs in a node environment with no DOM, so the
  row logic (state per row, size formatting, language summary) lives in a
  pure module `model-row-state.ts` with its own test; the Lit elements are
  covered by typecheck and a manual smoke run.

# Peer Tool Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the tool library is unreachable, install a group Tool by pulling its happ, UI and icon from an online group member, with continuous progress feedback.

**Architecture:** The protocol rides on the group DNA's existing arbitrary remote-signal relay (no DNA change). Pure chunking/validation lives in `@theweave/utils`, wire types in `@theweave/moss-types`. The renderer runs a stateless provider and a sequential requester per group; the main process only reads and writes the canonical `happs/`, `uis/` and `tools/` directories. `MossStore.installApplet` tries the library first and falls back to peers, publishing an `AppletInstallProgress` store that a new `<applet-install-progress>` element renders.

**Tech Stack:** TypeScript, LitElement + `@holochain-open-dev/stores`, Electron IPC, `@msgpack/msgpack`, node `crypto`, vitest (`yarn test:unit`), `@lit/localize`.

**Spec:** `plans/peer-tool-transfer.md`

## Global Constraints

- Strong typing everywhere; no `any` in new code.
- Zero additional stored data: the provider serves from `happs/<sha>.happ`, `uis/<sha>/assets/**` and `tools/<id>/icon` only.
- No group DNA change; only the `GroupRemoteSignal` union grows.
- Chunk size 512 KiB; requester window 4; offer timeout 10 s; chunk timeout 15 s; 3 attempts per chunk; manifest total cap 200 MB.
- All user-facing strings through `msg()` with translations for de, fr, es, tr, it, pt, ja, nl.
- Comments explain intent, never contrast with prior behavior.
- Commit messages carry no co-author or generated-by trailers.
- Unit tests run with `yarn test:unit` (vitest, includes `src/**/*.test.ts` and `shared/**/src/**/*.test.ts`).
- Build order: `build:libs` must build `@theweave/moss-types` before `@theweave/group-client` once group-client depends on it.

---

### Task 1: Wire types and the `peer` asset source

**Files:**
- Modify: `shared/types/src/types.ts` (after `AssetSource`, around line 178)
- Modify: `shared/group-client/package.json`, `shared/group-client/src/types.ts` (`GroupRemoteSignal`, line ~320)
- Modify: `package.json` `build:libs` order
- Modify: `src/main/filesystem.ts` `deriveAppAssetsInfo` (line 677)

**Interfaces:**
- Produces: `ToolTransferFile`, `ToolTransferManifest`, `ToolTransferRequest`, `ToolTransferMessage`, `AppletInstallProgress`, `AssetSource` with `{ type: 'peer' }`, `GroupRemoteSignal` variant `{ type: 'tool-transfer'; payload: ToolTransferMessage }`, `deriveAppAssetsInfo(distributionInfo, happOrWebHappUrl, sha256Happ, sha256Webhapp?, sha256Ui?, uiPort?, assetSource?)`.

- [ ] **Step 1: Add the types to `shared/types/src/types.ts`**

```ts
export type AssetSource =
  | { type: 'https'; url: string }
  | { type: 'filesystem' } // Installed from filesystem
  | { type: 'default-app' } // Shipped with the We executable by default
  | { type: 'peer' }; // Received from another member of a group

/**
 * ==================================================================
 * Peer tool transfer: fetching a Tool's assets from a group member
 * ==================================================================
 */

export type ToolTransferFile = {
  /** Relative posix path under uis/<sha256>/assets */
  path: string;
  size: number;
  sha256: string;
};

export type ToolTransferManifest = {
  happ: { sha256: string; size: number };
  ui: { sha256: string; files: ToolTransferFile[] };
  /** The icon file contents exactly as stored under tools/<toolCompatibilityId>/icon */
  icon: string;
  chunkSize: number;
};

export type ToolTransferRequest = {
  happSha256: string;
  uiSha256: string;
  toolCompatibilityId: string;
};

export type ToolTransferMessage =
  | ({ kind: 'request'; requestId: string; from: AgentPubKey } & ToolTransferRequest)
  | { kind: 'offer'; requestId: string; manifest: ToolTransferManifest }
  | { kind: 'unavailable'; requestId: string; reason: string }
  | ({ kind: 'chunk-request'; requestId: string; from: AgentPubKey; index: number } & ToolTransferRequest)
  | { kind: 'chunk'; requestId: string; index: number; bytes: Uint8Array };

export type AppletInstallProgress =
  | { phase: 'library' }
  | { phase: 'library-failed'; error: string }
  | { phase: 'peer-search' }
  | { phase: 'peer-none' }
  | { phase: 'peer-request'; peer: AgentPubKeyB64 }
  | { phase: 'peer-download'; peer: AgentPubKeyB64; chunksDone: number; chunksTotal: number }
  | { phase: 'peer-failed'; peer: AgentPubKeyB64; error: string }
  | { phase: 'installing' }
  | { phase: 'done' }
  | { phase: 'failed'; error: string };
```

Add `AgentPubKey, AgentPubKeyB64` to the `@holochain/client` import at the top of the file if missing.

- [ ] **Step 2: Make group-client depend on moss-types and add the signal variant**

In `shared/group-client/package.json` dependencies add `"@theweave/moss-types": "^0.7.0-dev.0"` (match the version string used by `shared/utils/package.json`). In `shared/group-client/src/types.ts`:

```ts
import { ToolTransferMessage } from '@theweave/moss-types';

export type GroupRemoteSignal =
  | { type: 'assets-signal'; content: SignalPayloadAssets }
  | { type: 'applet-signal'; appletId: AppletId; payload: Uint8Array }
  | { type: 'tool-transfer'; payload: ToolTransferMessage };
```

In root `package.json`, reorder `build:libs` so `yarn build:mt` runs before `yarn build:gc`.

- [ ] **Step 3: Thread `assetSource` through `deriveAppAssetsInfo`**

```ts
export function deriveAppAssetsInfo(
  distributionInfo: DistributionInfo,
  happOrWebHappUrl: string,
  sha256Happ: string,
  sha256Webhapp?: string,
  sha256Ui?: string,
  uiPort?: number,
  assetSource: AssetSource = { type: 'https', url: happOrWebHappUrl },
): AppAssetsInfo {
```

Replace every `assetSource: { type: 'https', url: happOrWebHappUrl }` literal in the function body with `assetSource`. Import `AssetSource` from `@theweave/moss-types`.

- [ ] **Step 4: Build and typecheck**

Run: `yarn install --check-files && yarn build:mt && yarn build:gc && yarn build:utils && yarn typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add shared/types/src/types.ts shared/group-client/package.json shared/group-client/src/types.ts package.json src/main/filesystem.ts yarn.lock
git commit -m "feat(types): wire types for fetching Tool assets from group members"
```

---

### Task 2: Pure chunking and manifest validation in `@theweave/utils`

**Files:**
- Create: `shared/utils/src/tool-transfer.ts`
- Create: `shared/utils/src/tool-transfer.test.ts`
- Modify: `shared/utils/src/index.ts` (add `export * from './tool-transfer.js';`)

**Interfaces:**
- Consumes: `ToolTransferManifest`, `ToolTransferFile` from Task 1.
- Produces:
  - `TOOL_TRANSFER_CHUNK_SIZE = 512 * 1024`, `TOOL_TRANSFER_MAX_TOTAL_BYTES = 200 * 1024 * 1024`
  - `type StreamSegment = { kind: 'happ' } | { kind: 'file'; path: string }`
  - `type StreamLayout = { segments: Array<{ segment: StreamSegment; offset: number; size: number }>; totalSize: number; chunkSize: number; chunkCount: number }`
  - `streamLayout(manifest: ToolTransferManifest): StreamLayout`
  - `type SegmentRead = { segment: StreamSegment; offset: number; length: number }` (offset within the segment)
  - `chunkReads(layout: StreamLayout, index: number): SegmentRead[]`
  - `splitStream(layout: StreamLayout, bytes: Uint8Array): { happ: Uint8Array; files: Array<{ path: string; bytes: Uint8Array }> }`
  - `isSha256Hex(s: string): boolean`, `isSafeRelativePath(p: string): boolean`, `isSafePathSegment(s: string): boolean`
  - `validateToolTransferManifest(manifest: ToolTransferManifest, expected: { happSha256: string; uiSha256: string }): string | undefined` (returns an error message, `undefined` when valid)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { ToolTransferManifest } from '@theweave/moss-types';
import {
  chunkReads,
  isSafeRelativePath,
  splitStream,
  streamLayout,
  validateToolTransferManifest,
} from './tool-transfer.js';

const H = 'a'.repeat(64);
const U = 'b'.repeat(64);

function manifest(files: Array<[string, number]>, happSize: number, chunkSize: number): ToolTransferManifest {
  return {
    happ: { sha256: H, size: happSize },
    ui: { sha256: U, files: files.map(([path, size]) => ({ path, size, sha256: 'c'.repeat(64) })) },
    icon: 'data:image/png;base64,AAAA',
    chunkSize,
  };
}

describe('streamLayout', () => {
  it('lays out the happ first, then files in manifest order, and counts chunks', () => {
    const layout = streamLayout(manifest([['index.html', 5], ['assets/a.js', 7]], 10, 8));
    expect(layout.totalSize).toBe(22);
    expect(layout.chunkCount).toBe(3);
    expect(layout.segments.map((s) => s.offset)).toEqual([0, 10, 15]);
  });
  it('has zero chunks for an empty stream', () => {
    expect(streamLayout(manifest([], 0, 8)).chunkCount).toBe(0);
  });
});

describe('chunkReads', () => {
  it('spans segment boundaries and clips the final chunk', () => {
    const layout = streamLayout(manifest([['index.html', 5], ['assets/a.js', 7]], 10, 8));
    expect(chunkReads(layout, 0)).toEqual([{ segment: { kind: 'happ' }, offset: 0, length: 8 }]);
    expect(chunkReads(layout, 1)).toEqual([
      { segment: { kind: 'happ' }, offset: 8, length: 2 },
      { segment: { kind: 'file', path: 'index.html' }, offset: 0, length: 5 },
      { segment: { kind: 'file', path: 'assets/a.js' }, offset: 0, length: 1 },
    ]);
    expect(chunkReads(layout, 2)).toEqual([
      { segment: { kind: 'file', path: 'assets/a.js' }, offset: 1, length: 6 },
    ]);
  });
  it('rejects an out-of-range index', () => {
    const layout = streamLayout(manifest([], 10, 8));
    expect(() => chunkReads(layout, 2)).toThrow();
    expect(() => chunkReads(layout, -1)).toThrow();
  });
});

describe('splitStream', () => {
  it('round-trips bytes through chunking and reassembly', () => {
    const happ = Uint8Array.from({ length: 10 }, (_, i) => i);
    const a = Uint8Array.from({ length: 5 }, (_, i) => 100 + i);
    const b = Uint8Array.from({ length: 7 }, (_, i) => 200 + i);
    const layout = streamLayout(manifest([['index.html', 5], ['assets/a.js', 7]], 10, 8));
    const stream = new Uint8Array([...happ, ...a, ...b]);
    const parts = splitStream(layout, stream);
    expect(parts.happ).toEqual(happ);
    expect(parts.files).toEqual([
      { path: 'index.html', bytes: a },
      { path: 'assets/a.js', bytes: b },
    ]);
  });
  it('rejects a stream whose length does not match the layout', () => {
    const layout = streamLayout(manifest([], 10, 8));
    expect(() => splitStream(layout, new Uint8Array(9))).toThrow();
  });
});

describe('isSafeRelativePath', () => {
  it.each(['index.html', 'assets/a.js', 'a/b/c.txt'])('accepts %s', (p) => {
    expect(isSafeRelativePath(p)).toBe(true);
  });
  it.each(['', '/etc/passwd', '../x', 'a/../b', 'a//b', 'a/./b', 'C:\\x', 'a\\b', 'a\0b'])(
    'rejects %j',
    (p) => {
      expect(isSafeRelativePath(p)).toBe(false);
    },
  );
});

describe('validateToolTransferManifest', () => {
  const expected = { happSha256: H, uiSha256: U };
  it('accepts a well-formed manifest', () => {
    expect(validateToolTransferManifest(manifest([['index.html', 5]], 10, 8), expected)).toBeUndefined();
  });
  it('rejects hash mismatches', () => {
    expect(validateToolTransferManifest(manifest([], 1, 8), { ...expected, happSha256: 'f'.repeat(64) })).toMatch(/happ/);
    expect(validateToolTransferManifest(manifest([], 1, 8), { ...expected, uiSha256: 'f'.repeat(64) })).toMatch(/ui/i);
  });
  it('rejects unsafe paths, bad sizes, bad file hashes, and oversize totals', () => {
    expect(validateToolTransferManifest(manifest([['../x', 1]], 1, 8), expected)).toMatch(/path/);
    expect(validateToolTransferManifest(manifest([['a', -1]], 1, 8), expected)).toMatch(/size/);
    const m = manifest([['a', 1]], 1, 8);
    m.ui.files[0].sha256 = 'nope';
    expect(validateToolTransferManifest(m, expected)).toMatch(/sha256/);
    expect(validateToolTransferManifest(manifest([['a', 300 * 1024 * 1024]], 1, 8), expected)).toMatch(/large/);
    expect(validateToolTransferManifest(manifest([], 1, 0), expected)).toMatch(/chunk/);
  });
  it('rejects duplicate paths', () => {
    expect(validateToolTransferManifest(manifest([['a', 1], ['a', 1]], 1, 8), expected)).toMatch(/duplicate/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run shared/utils/src/tool-transfer.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `shared/utils/src/tool-transfer.ts`**

```ts
import { ToolTransferManifest } from '@theweave/moss-types';

export const TOOL_TRANSFER_CHUNK_SIZE = 512 * 1024;
export const TOOL_TRANSFER_MAX_TOTAL_BYTES = 200 * 1024 * 1024;

export type StreamSegment = { kind: 'happ' } | { kind: 'file'; path: string };

export type StreamLayout = {
  segments: Array<{ segment: StreamSegment; offset: number; size: number }>;
  totalSize: number;
  chunkSize: number;
  chunkCount: number;
};

export type SegmentRead = { segment: StreamSegment; offset: number; length: number };

/**
 * The transfer treats a Tool as one virtual byte stream: the happ followed by
 * every UI file in manifest order. This layout is the single source of truth
 * for where each piece sits in that stream, so provider and requester agree
 * without exchanging anything beyond the manifest.
 */
export function streamLayout(manifest: ToolTransferManifest): StreamLayout {
  const segments: StreamLayout['segments'] = [];
  let offset = 0;
  segments.push({ segment: { kind: 'happ' }, offset, size: manifest.happ.size });
  offset += manifest.happ.size;
  for (const file of manifest.ui.files) {
    segments.push({ segment: { kind: 'file', path: file.path }, offset, size: file.size });
    offset += file.size;
  }
  const chunkSize = manifest.chunkSize;
  return {
    segments,
    totalSize: offset,
    chunkSize,
    chunkCount: chunkSize > 0 ? Math.ceil(offset / chunkSize) : 0,
  };
}

export function chunkReads(layout: StreamLayout, index: number): SegmentRead[] {
  if (!Number.isInteger(index) || index < 0 || index >= layout.chunkCount) {
    throw new Error(`Chunk index ${index} out of range (0..${layout.chunkCount - 1})`);
  }
  const start = index * layout.chunkSize;
  const end = Math.min(start + layout.chunkSize, layout.totalSize);
  const reads: SegmentRead[] = [];
  for (const { segment, offset, size } of layout.segments) {
    const segEnd = offset + size;
    const from = Math.max(start, offset);
    const to = Math.min(end, segEnd);
    if (to > from) reads.push({ segment, offset: from - offset, length: to - from });
  }
  return reads;
}

export function splitStream(
  layout: StreamLayout,
  bytes: Uint8Array,
): { happ: Uint8Array; files: Array<{ path: string; bytes: Uint8Array }> } {
  if (bytes.length !== layout.totalSize) {
    throw new Error(`Stream has ${bytes.length} bytes, layout expects ${layout.totalSize}`);
  }
  let happ = new Uint8Array(0);
  const files: Array<{ path: string; bytes: Uint8Array }> = [];
  for (const { segment, offset, size } of layout.segments) {
    const slice = bytes.slice(offset, offset + size);
    if (segment.kind === 'happ') happ = slice;
    else files.push({ path: segment.path, bytes: slice });
  }
  return { happ, files };
}

export function isSha256Hex(s: string): boolean {
  return /^[0-9a-f]{64}$/.test(s);
}

/** One path segment with no separators or traversal, e.g. a tool id. */
export function isSafePathSegment(s: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(s) && s !== '.' && s !== '..';
}

/**
 * Paths in a manifest are written to disk under a directory we choose, so
 * they must be plain relative posix paths: no absolute prefix, no `..`, no
 * empty or `.` segments, no backslashes or control characters.
 */
export function isSafeRelativePath(p: string): boolean {
  if (p.length === 0 || p.length > 1024) return false;
  if (/[\\\0]/.test(p)) return false;
  if (p.startsWith('/')) return false;
  return p.split('/').every((seg) => isSafePathSegment(seg));
}

export function validateToolTransferManifest(
  manifest: ToolTransferManifest,
  expected: { happSha256: string; uiSha256: string },
): string | undefined {
  if (manifest.happ.sha256 !== expected.happSha256) return 'Manifest happ sha256 does not match the requested Tool';
  if (manifest.ui.sha256 !== expected.uiSha256) return 'Manifest UI sha256 does not match the requested Tool';
  if (!Number.isInteger(manifest.chunkSize) || manifest.chunkSize <= 0) return 'Manifest chunk size must be a positive integer';
  if (!Number.isInteger(manifest.happ.size) || manifest.happ.size <= 0) return 'Manifest happ size must be a positive integer';
  if (typeof manifest.icon !== 'string' || manifest.icon.length === 0) return 'Manifest icon is missing';
  if (manifest.ui.files.length === 0) return 'Manifest lists no UI files';
  let total = manifest.happ.size;
  const seen = new Set<string>();
  for (const file of manifest.ui.files) {
    if (!isSafeRelativePath(file.path)) return `Unsafe file path in manifest: ${JSON.stringify(file.path)}`;
    if (seen.has(file.path)) return `Duplicate file path in manifest: ${file.path}`;
    seen.add(file.path);
    if (!Number.isInteger(file.size) || file.size < 0) return `Invalid size for ${file.path}`;
    if (!isSha256Hex(file.sha256)) return `Invalid sha256 for ${file.path}`;
    total += file.size;
  }
  if (total > TOOL_TRANSFER_MAX_TOTAL_BYTES) return `Manifest total of ${total} bytes is too large`;
  return undefined;
}
```

Add `export * from './tool-transfer.js';` to `shared/utils/src/index.ts`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run shared/utils/src/tool-transfer.test.ts`
Expected: PASS.

- [ ] **Step 5: Build and commit**

```bash
yarn build:utils
git add shared/utils/src/tool-transfer.ts shared/utils/src/tool-transfer.test.ts shared/utils/src/index.ts
git commit -m "feat(utils): chunk layout and manifest validation for peer Tool transfer"
```

---

### Task 3: Main-process asset reader/writer and IPC

**Files:**
- Create: `src/main/peerToolAssets.ts`
- Create: `src/main/peerToolAssets.test.ts`
- Modify: `src/main/index.ts` (three `ipcMain.handle` near `fetch-and-validate-happ-or-webhapp`, line ~2444; extend `install-applet-bundle` args, line ~2816 and the `deriveAppAssetsInfo` call at ~3008)
- Modify: `src/preload/admin.ts` (line ~103)
- Modify: `src/renderer/src/electron-api.ts` (line ~149)

**Interfaces:**
- Consumes: Task 1 types, Task 2 functions.
- Produces (module):
  - `type ToolAssetDirs = { happsDir: string; uisDir: string; toolsDir: string }`
  - `readToolAssetsManifest(dirs, request: ToolTransferRequest, chunkSize: number): Promise<ToolTransferManifest | undefined>`
  - `readToolAssetsChunk(dirs, request: ToolTransferRequest, index: number, chunkSize: number): Promise<Uint8Array>`
  - `storeToolAssetsFromPeer(dirs, manifest: ToolTransferManifest, bytes: Uint8Array, expected: ToolTransferRequest): Promise<void>`
- Produces (IPC / `window.electronAPI`):
  - `readToolAssetsManifest(request: ToolTransferRequest, chunkSize: number): Promise<ToolTransferManifest | undefined>` → channel `read-tool-assets-manifest`
  - `readToolAssetsChunk(request: ToolTransferRequest, index: number, chunkSize: number): Promise<Uint8Array>` → `read-tool-assets-chunk`
  - `storeToolAssetsFromPeer(manifest: ToolTransferManifest, bytes: Uint8Array, expected: ToolTransferRequest): Promise<void>` → `store-tool-assets-from-peer`
  - `installAppletBundle(appId, networkSeed, happOrWebHappUrl, distributionInfo, appHashes, uiPort?, roles_settings?, assetSource?: AssetSource): Promise<AppInfo>`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { streamLayout, chunkReads } from '@theweave/utils';
import {
  readToolAssetsChunk,
  readToolAssetsManifest,
  storeToolAssetsFromPeer,
  ToolAssetDirs,
} from './peerToolAssets';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

let root: string;
let dirs: ToolAssetDirs;
const happ = Uint8Array.from({ length: 3000 }, (_, i) => i % 251);
const HAPP = sha(happ);
const UI = 'b'.repeat(64);
const TOOL = 'tool123';
const files: Record<string, Uint8Array> = {
  'index.html': new TextEncoder().encode('<html></html>'),
  'assets/app.js': Uint8Array.from({ length: 2500 }, (_, i) => (i * 7) % 256),
  'weave.config.json': new TextEncoder().encode('{}'),
};
const request = { happSha256: HAPP, uiSha256: UI, toolCompatibilityId: TOOL };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-tool-assets-'));
  dirs = {
    happsDir: path.join(root, 'happs'),
    uisDir: path.join(root, 'uis'),
    toolsDir: path.join(root, 'tools'),
  };
  fs.mkdirSync(dirs.happsDir, { recursive: true });
  fs.writeFileSync(path.join(dirs.happsDir, `${HAPP}.happ`), happ);
  for (const [rel, bytes] of Object.entries(files)) {
    const p = path.join(dirs.uisDir, UI, 'assets', rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, bytes);
  }
  fs.mkdirSync(path.join(dirs.toolsDir, TOOL), { recursive: true });
  fs.writeFileSync(path.join(dirs.toolsDir, TOOL, 'icon'), 'data:image/png;base64,AAAA', 'utf-8');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('readToolAssetsManifest', () => {
  it('lists files sorted by path with sizes and hashes', async () => {
    const m = await readToolAssetsManifest(dirs, request, 1024);
    expect(m).toBeDefined();
    expect(m!.happ).toEqual({ sha256: HAPP, size: happ.length });
    expect(m!.ui.files.map((f) => f.path)).toEqual(['assets/app.js', 'index.html', 'weave.config.json']);
    expect(m!.ui.files[1]).toEqual({ path: 'index.html', size: files['index.html'].length, sha256: sha(files['index.html']) });
    expect(m!.icon).toBe('data:image/png;base64,AAAA');
    expect(m!.chunkSize).toBe(1024);
  });
  it('returns undefined when the happ, UI or icon is missing', async () => {
    expect(await readToolAssetsManifest(dirs, { ...request, happSha256: 'f'.repeat(64) }, 1024)).toBeUndefined();
    expect(await readToolAssetsManifest(dirs, { ...request, uiSha256: 'f'.repeat(64) }, 1024)).toBeUndefined();
    expect(await readToolAssetsManifest(dirs, { ...request, toolCompatibilityId: 'nope' }, 1024)).toBeUndefined();
  });
  it('refuses hashes that are not 64 lowercase hex characters', async () => {
    await expect(readToolAssetsManifest(dirs, { ...request, happSha256: '../x' }, 1024)).rejects.toThrow();
    await expect(readToolAssetsManifest(dirs, { ...request, toolCompatibilityId: '../x' }, 1024)).rejects.toThrow();
  });
});

describe('readToolAssetsChunk + storeToolAssetsFromPeer', () => {
  it('serves chunks that reassemble into the original files', async () => {
    const m = (await readToolAssetsManifest(dirs, request, 1024))!;
    const layout = streamLayout(m);
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < layout.chunkCount; i++) chunks.push(await readToolAssetsChunk(dirs, request, i, 1024));
    expect(chunks.slice(0, -1).every((c) => c.length === 1024)).toBe(true);
    const stream = new Uint8Array(layout.totalSize);
    chunks.forEach((c, i) => stream.set(c, i * 1024));

    const target: ToolAssetDirs = {
      happsDir: path.join(root, 'b', 'happs'),
      uisDir: path.join(root, 'b', 'uis'),
      toolsDir: path.join(root, 'b', 'tools'),
    };
    await storeToolAssetsFromPeer(target, m, stream, request);
    expect(fs.readFileSync(path.join(target.happsDir, `${HAPP}.happ`))).toEqual(Buffer.from(happ));
    for (const [rel, bytes] of Object.entries(files)) {
      expect(fs.readFileSync(path.join(target.uisDir, UI, 'assets', rel))).toEqual(Buffer.from(bytes));
    }
    expect(fs.readFileSync(path.join(target.toolsDir, TOOL, 'icon'), 'utf-8')).toBe('data:image/png;base64,AAAA');
  });
  it('writes nothing when the happ hash does not match', async () => {
    const m = (await readToolAssetsManifest(dirs, request, 1024))!;
    const layout = streamLayout(m);
    const stream = new Uint8Array(layout.totalSize);
    stream[0] = 255; // corrupt the happ
    const target: ToolAssetDirs = {
      happsDir: path.join(root, 'c', 'happs'),
      uisDir: path.join(root, 'c', 'uis'),
      toolsDir: path.join(root, 'c', 'tools'),
    };
    await expect(storeToolAssetsFromPeer(target, m, stream, request)).rejects.toThrow(/happ/);
    expect(fs.existsSync(target.happsDir)).toBe(false);
    expect(fs.existsSync(target.uisDir)).toBe(false);
  });
  it('rejects a manifest with a traversal path before writing', async () => {
    const m = (await readToolAssetsManifest(dirs, request, 1024))!;
    m.ui.files[0].path = '../escape';
    const stream = new Uint8Array(streamLayout(m).totalSize);
    await expect(storeToolAssetsFromPeer(dirs, m, stream, request)).rejects.toThrow(/path/);
    expect(fs.existsSync(path.join(root, 'uis', 'escape'))).toBe(false);
  });
  it('rejects an out-of-range chunk index', async () => {
    await expect(readToolAssetsChunk(dirs, request, 999, 1024)).rejects.toThrow();
  });
});
```

`chunkReads` is imported to keep the test honest about which helper is exercised; remove the import if unused after implementation.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/peerToolAssets.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/main/peerToolAssets.ts`**

```ts
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ToolTransferManifest, ToolTransferRequest, ToolTransferFile } from '@theweave/moss-types';
import {
  chunkReads,
  isSafePathSegment,
  isSha256Hex,
  splitStream,
  streamLayout,
  validateToolTransferManifest,
} from '@theweave/utils';

export type ToolAssetDirs = { happsDir: string; uisDir: string; toolsDir: string };

function assertRequestIsSafe(request: ToolTransferRequest): void {
  if (!isSha256Hex(request.happSha256)) throw new Error('Invalid happ sha256');
  if (!isSha256Hex(request.uiSha256)) throw new Error('Invalid UI sha256');
  if (!isSafePathSegment(request.toolCompatibilityId)) throw new Error('Invalid tool id');
}

function happPath(dirs: ToolAssetDirs, request: ToolTransferRequest): string {
  return path.join(dirs.happsDir, `${request.happSha256}.happ`);
}
function uiAssetsDir(dirs: ToolAssetDirs, request: ToolTransferRequest): string {
  return path.join(dirs.uisDir, request.uiSha256, 'assets');
}
function iconPath(dirs: ToolAssetDirs, request: ToolTransferRequest): string {
  return path.join(dirs.toolsDir, request.toolCompatibilityId, 'icon');
}

async function listFilesRecursive(dir: string, prefix = ''): Promise<string[]> {
  const entries = await fsPromises.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFilesRecursive(path.join(dir, entry.name), rel)));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

async function sha256File(p: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const piece of fs.createReadStream(p)) hash.update(piece as Buffer);
  return hash.digest('hex');
}

/**
 * The manifest is rebuilt from disk on every call so the provider carries no
 * state between messages. Sorting by path makes each rebuild identical, which
 * is what lets a chunk request be served against a fresh manifest.
 */
export async function readToolAssetsManifest(
  dirs: ToolAssetDirs,
  request: ToolTransferRequest,
  chunkSize: number,
): Promise<ToolTransferManifest | undefined> {
  assertRequestIsSafe(request);
  const happ = happPath(dirs, request);
  const assets = uiAssetsDir(dirs, request);
  const icon = iconPath(dirs, request);
  if (!fs.existsSync(happ) || !fs.existsSync(assets) || !fs.existsSync(icon)) return undefined;

  const happSize = (await fsPromises.stat(happ)).size;
  const paths = (await listFilesRecursive(assets)).sort();
  const files: ToolTransferFile[] = [];
  for (const rel of paths) {
    const abs = path.join(assets, ...rel.split('/'));
    files.push({ path: rel, size: (await fsPromises.stat(abs)).size, sha256: await sha256File(abs) });
  }
  return {
    happ: { sha256: request.happSha256, size: happSize },
    ui: { sha256: request.uiSha256, files },
    icon: await fsPromises.readFile(icon, 'utf-8'),
    chunkSize,
  };
}

async function readRange(p: string, offset: number, length: number): Promise<Uint8Array> {
  const handle = await fsPromises.open(p, 'r');
  try {
    const buf = new Uint8Array(length);
    let read = 0;
    while (read < length) {
      const { bytesRead } = await handle.read(buf, read, length - read, offset + read);
      if (bytesRead === 0) throw new Error(`Unexpected end of file reading ${p}`);
      read += bytesRead;
    }
    return buf;
  } finally {
    await handle.close();
  }
}

export async function readToolAssetsChunk(
  dirs: ToolAssetDirs,
  request: ToolTransferRequest,
  index: number,
  chunkSize: number,
): Promise<Uint8Array> {
  const manifest = await readToolAssetsManifest(dirs, request, chunkSize);
  if (!manifest) throw new Error('Tool assets not available');
  const layout = streamLayout(manifest);
  const reads = chunkReads(layout, index);
  const pieces: Uint8Array[] = [];
  for (const { segment, offset, length } of reads) {
    const p =
      segment.kind === 'happ'
        ? happPath(dirs, request)
        : path.join(uiAssetsDir(dirs, request), ...segment.path.split('/'));
    pieces.push(await readRange(p, offset, length));
  }
  const total = pieces.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of pieces) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Main is the trust boundary for the filesystem, so the manifest is validated
 * again here regardless of what the renderer checked, and every hash is
 * verified before a single byte is written.
 */
export async function storeToolAssetsFromPeer(
  dirs: ToolAssetDirs,
  manifest: ToolTransferManifest,
  bytes: Uint8Array,
  expected: ToolTransferRequest,
): Promise<void> {
  assertRequestIsSafe(expected);
  const problem = validateToolTransferManifest(manifest, expected);
  if (problem) throw new Error(problem);

  const { happ, files } = splitStream(streamLayout(manifest), bytes);
  if (sha256Bytes(happ) !== expected.happSha256) {
    throw new Error('Received happ bytes do not match the expected happ sha256');
  }
  for (const [i, file] of files.entries()) {
    if (sha256Bytes(file.bytes) !== manifest.ui.files[i].sha256) {
      throw new Error(`Received bytes for ${file.path} do not match the manifest sha256`);
    }
  }

  const happTarget = happPath(dirs, expected);
  if (!fs.existsSync(happTarget)) {
    await fsPromises.mkdir(dirs.happsDir, { recursive: true });
    await fsPromises.writeFile(happTarget, happ);
  }
  const assets = uiAssetsDir(dirs, expected);
  for (const file of files) {
    const target = path.join(assets, ...file.path.split('/'));
    await fsPromises.mkdir(path.dirname(target), { recursive: true });
    await fsPromises.writeFile(target, file.bytes);
  }
  const icon = iconPath(dirs, expected);
  if (!fs.existsSync(icon)) {
    await fsPromises.mkdir(path.dirname(icon), { recursive: true });
    await fsPromises.writeFile(icon, manifest.icon, 'utf-8');
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/main/peerToolAssets.test.ts`
Expected: PASS.

- [ ] **Step 5: Register IPC handlers in `src/main/index.ts`**

Next to the `fetch-and-validate-happ-or-webhapp` handler:

```ts
    const toolAssetDirs = (): ToolAssetDirs => ({
      happsDir: WE_FILE_SYSTEM.happsDir,
      uisDir: WE_FILE_SYSTEM.uisDir,
      toolsDir: WE_FILE_SYSTEM.toolsDir,
    });
    ipcMain.handle(
      'read-tool-assets-manifest',
      async (_e, request: ToolTransferRequest, chunkSize: number) =>
        readToolAssetsManifest(toolAssetDirs(), request, chunkSize),
    );
    ipcMain.handle(
      'read-tool-assets-chunk',
      async (_e, request: ToolTransferRequest, index: number, chunkSize: number) =>
        readToolAssetsChunk(toolAssetDirs(), request, index, chunkSize),
    );
    ipcMain.handle(
      'store-tool-assets-from-peer',
      async (_e, manifest: ToolTransferManifest, bytes: Uint8Array, expected: ToolTransferRequest) =>
        storeToolAssetsFromPeer(toolAssetDirs(), manifest, bytes, expected),
    );
```

Import `ToolTransferManifest, ToolTransferRequest, AssetSource` from `@theweave/moss-types` and the three functions plus `ToolAssetDirs` from `./peerToolAssets`.

Extend `install-applet-bundle`: add a trailing `assetSource?: AssetSource` parameter and pass it as the last argument of the `deriveAppAssetsInfo(...)` call inside that handler (the one after "Store app metadata").

- [ ] **Step 6: Preload and renderer typings**

`src/preload/admin.ts`: rename the stale positional params so they match main, and add the new bridges:

```ts
  installAppletBundle: (
    appId: string,
    networkSeed: string,
    happOrWebHappUrl: string,
    distributionInfo: DistributionInfo,
    appHashes: AppHashes,
    uiPort?: number,
    roles_settings?: RoleSettingsMap,
    assetSource?: AssetSource,
  ) =>
    ipcRenderer.invoke(
      'install-applet-bundle',
      appId,
      networkSeed,
      happOrWebHappUrl,
      distributionInfo,
      appHashes,
      uiPort,
      roles_settings,
      assetSource,
    ),
  readToolAssetsManifest: (request: ToolTransferRequest, chunkSize: number) =>
    ipcRenderer.invoke('read-tool-assets-manifest', request, chunkSize),
  readToolAssetsChunk: (request: ToolTransferRequest, index: number, chunkSize: number) =>
    ipcRenderer.invoke('read-tool-assets-chunk', request, index, chunkSize),
  storeToolAssetsFromPeer: (
    manifest: ToolTransferManifest,
    bytes: Uint8Array,
    expected: ToolTransferRequest,
  ) => ipcRenderer.invoke('store-tool-assets-from-peer', manifest, bytes, expected),
```

`src/renderer/src/electron-api.ts`: add `assetSource?: AssetSource` to `installAppletBundle` and

```ts
      readToolAssetsManifest: (
        request: ToolTransferRequest,
        chunkSize: number,
      ) => Promise<ToolTransferManifest | undefined>;
      readToolAssetsChunk: (
        request: ToolTransferRequest,
        index: number,
        chunkSize: number,
      ) => Promise<Uint8Array>;
      storeToolAssetsFromPeer: (
        manifest: ToolTransferManifest,
        bytes: Uint8Array,
        expected: ToolTransferRequest,
      ) => Promise<void>;
```

- [ ] **Step 7: Run the unit suite and typecheck**

Run: `yarn test:unit && yarn typecheck`
Expected: PASS including `ipc-contract-drift.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/main/peerToolAssets.ts src/main/peerToolAssets.test.ts src/main/index.ts src/preload/admin.ts src/renderer/src/electron-api.ts
git commit -m "feat(main): serve and store Tool assets for peer transfer"
```

---

### Task 4: Renderer provider and requester (pure, fake-transport tested)

**Files:**
- Create: `src/renderer/src/groups/tool-transfer/transport.ts`
- Create: `src/renderer/src/groups/tool-transfer/provider.ts`
- Create: `src/renderer/src/groups/tool-transfer/requester.ts`
- Create: `src/renderer/src/groups/tool-transfer/provider.test.ts`
- Create: `src/renderer/src/groups/tool-transfer/requester.test.ts`

**Interfaces:**
- Consumes: Task 1 types; `streamLayout`, `validateToolTransferManifest`, `TOOL_TRANSFER_CHUNK_SIZE` from Task 2.
- Produces:
  - `interface ToolTransferTransport { send(to: AgentPubKey, message: ToolTransferMessage): Promise<void>; onMessage(listener: (message: ToolTransferMessage) => void): () => void }`
  - `interface ToolAssetReader { readManifest(request: ToolTransferRequest, chunkSize: number): Promise<ToolTransferManifest | undefined>; readChunk(request: ToolTransferRequest, index: number, chunkSize: number): Promise<Uint8Array> }`
  - `handleProviderMessage(message: ToolTransferMessage, transport: ToolTransferTransport, reader: ToolAssetReader, chunkSize?: number): Promise<void>`
  - `type RequesterOptions = { offerTimeoutMs: number; chunkTimeoutMs: number; chunkAttempts: number; window: number; chunkSize: number }` and `DEFAULT_REQUESTER_OPTIONS`
  - `type RequesterEvent = { type: 'requesting'; peer: AgentPubKey } | { type: 'progress'; peer: AgentPubKey; chunksDone: number; chunksTotal: number } | { type: 'peer-failed'; peer: AgentPubKey; error: string }`
  - `requestToolFromPeer(transport, me: AgentPubKey, peer: AgentPubKey, request: ToolTransferRequest, onEvent: (e: RequesterEvent) => void, options?: RequesterOptions): Promise<{ manifest: ToolTransferManifest; bytes: Uint8Array }>`
  - `requestToolFromPeers(transport, me, peers: AgentPubKey[], request, onEvent, options?): Promise<{ manifest; bytes; peer: AgentPubKey }>` (throws `Error('No peer could provide the Tool')` after exhausting all peers)

- [ ] **Step 1: Write `transport.ts`**

```ts
import { AgentPubKey } from '@holochain/client';
import { ToolTransferManifest, ToolTransferMessage, ToolTransferRequest } from '@theweave/moss-types';

export interface ToolTransferTransport {
  send(to: AgentPubKey, message: ToolTransferMessage): Promise<void>;
  onMessage(listener: (message: ToolTransferMessage) => void): () => void;
}

export interface ToolAssetReader {
  readManifest(request: ToolTransferRequest, chunkSize: number): Promise<ToolTransferManifest | undefined>;
  readChunk(request: ToolTransferRequest, index: number, chunkSize: number): Promise<Uint8Array>;
}
```

- [ ] **Step 2: Write the failing provider test**

```ts
import { describe, it, expect } from 'vitest';
import { AgentPubKey } from '@holochain/client';
import { ToolTransferManifest, ToolTransferMessage } from '@theweave/moss-types';
import { handleProviderMessage } from './provider';
import { ToolAssetReader, ToolTransferTransport } from './transport';

const requester = new Uint8Array([1, 2, 3]) as AgentPubKey;
const request = { happSha256: 'a'.repeat(64), uiSha256: 'b'.repeat(64), toolCompatibilityId: 'tool' };
const manifest: ToolTransferManifest = {
  happ: { sha256: 'a'.repeat(64), size: 3 },
  ui: { sha256: 'b'.repeat(64), files: [{ path: 'index.html', size: 2, sha256: 'c'.repeat(64) }] },
  icon: 'icon',
  chunkSize: 4,
};

function fakes(reader: Partial<ToolAssetReader>) {
  const sent: Array<{ to: AgentPubKey; message: ToolTransferMessage }> = [];
  const transport: ToolTransferTransport = {
    send: async (to, message) => {
      sent.push({ to, message });
    },
    onMessage: () => () => {},
  };
  const fullReader: ToolAssetReader = {
    readManifest: async () => undefined,
    readChunk: async () => new Uint8Array(),
    ...reader,
  };
  return { sent, transport, reader: fullReader };
}

describe('handleProviderMessage', () => {
  it('answers a request with an offer when the assets exist', async () => {
    const { sent, transport, reader } = fakes({ readManifest: async () => manifest });
    await handleProviderMessage({ kind: 'request', requestId: 'r1', from: requester, ...request }, transport, reader, 4);
    expect(sent).toEqual([{ to: requester, message: { kind: 'offer', requestId: 'r1', manifest } }]);
  });
  it('answers a request with unavailable when the assets are missing or reading fails', async () => {
    const { sent, transport, reader } = fakes({});
    await handleProviderMessage({ kind: 'request', requestId: 'r1', from: requester, ...request }, transport, reader);
    expect(sent[0].message).toMatchObject({ kind: 'unavailable', requestId: 'r1' });
    const failing = fakes({ readManifest: async () => { throw new Error('boom'); } });
    await handleProviderMessage({ kind: 'request', requestId: 'r2', from: requester, ...request }, failing.transport, failing.reader);
    expect(failing.sent[0].message).toMatchObject({ kind: 'unavailable', requestId: 'r2', reason: expect.stringContaining('boom') });
  });
  it('answers a chunk request with the chunk bytes', async () => {
    const bytes = new Uint8Array([9, 9]);
    const { sent, transport, reader } = fakes({ readChunk: async (_r, index) => (index === 1 ? bytes : new Uint8Array()) });
    await handleProviderMessage({ kind: 'chunk-request', requestId: 'r1', from: requester, index: 1, ...request }, transport, reader, 4);
    expect(sent).toEqual([{ to: requester, message: { kind: 'chunk', requestId: 'r1', index: 1, bytes } }]);
  });
  it('stays silent on a failing chunk read and on requester-bound messages', async () => {
    const { sent, transport, reader } = fakes({ readChunk: async () => { throw new Error('nope'); } });
    await handleProviderMessage({ kind: 'chunk-request', requestId: 'r1', from: requester, index: 0, ...request }, transport, reader);
    await handleProviderMessage({ kind: 'offer', requestId: 'r1', manifest }, transport, reader);
    await handleProviderMessage({ kind: 'chunk', requestId: 'r1', index: 0, bytes: new Uint8Array() }, transport, reader);
    expect(sent).toEqual([]);
  });
});
```

Note: `chunk-request` carries the request identity (`happSha256`, `uiSha256`, `toolCompatibilityId`) so the stateless provider knows what to read; Task 1 defines it that way.

- [ ] **Step 3: Implement `provider.ts`**

```ts
import { ToolTransferMessage } from '@theweave/moss-types';
import { TOOL_TRANSFER_CHUNK_SIZE } from '@theweave/utils';
import { ToolAssetReader, ToolTransferTransport } from './transport';

/**
 * The provider holds no state: every message carries enough to answer it from
 * disk, so a Moss that restarts mid-transfer simply keeps answering.
 */
export async function handleProviderMessage(
  message: ToolTransferMessage,
  transport: ToolTransferTransport,
  reader: ToolAssetReader,
  chunkSize: number = TOOL_TRANSFER_CHUNK_SIZE,
): Promise<void> {
  switch (message.kind) {
    case 'request': {
      const { requestId, from, happSha256, uiSha256, toolCompatibilityId } = message;
      const request = { happSha256, uiSha256, toolCompatibilityId };
      try {
        const manifest = await reader.readManifest(request, chunkSize);
        if (manifest) await transport.send(from, { kind: 'offer', requestId, manifest });
        else await transport.send(from, { kind: 'unavailable', requestId, reason: 'Tool assets not on disk' });
      } catch (e) {
        await transport.send(from, { kind: 'unavailable', requestId, reason: `Failed to read Tool assets: ${e}` });
      }
      return;
    }
    case 'chunk-request': {
      const { requestId, from, index, happSha256, uiSha256, toolCompatibilityId } = message;
      try {
        const bytes = await reader.readChunk({ happSha256, uiSha256, toolCompatibilityId }, index, chunkSize);
        await transport.send(from, { kind: 'chunk', requestId, index, bytes });
      } catch (e) {
        console.warn(`[tool-transfer] failed to serve chunk ${index} for request ${requestId}: ${e}`);
      }
      return;
    }
    default:
      return;
  }
}
```

- [ ] **Step 4: Run provider tests**

Run: `npx vitest run src/renderer/src/groups/tool-transfer/provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing requester test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { AgentPubKey } from '@holochain/client';
import { ToolTransferManifest, ToolTransferMessage } from '@theweave/moss-types';
import { streamLayout } from '@theweave/utils';
import { requestToolFromPeers, RequesterEvent, RequesterOptions } from './requester';
import { ToolTransferTransport } from './transport';

const me = new Uint8Array([0]) as AgentPubKey;
const alice = new Uint8Array([1]) as AgentPubKey;
const bob = new Uint8Array([2]) as AgentPubKey;
const request = { happSha256: 'a'.repeat(64), uiSha256: 'b'.repeat(64), toolCompatibilityId: 'tool' };
const manifest: ToolTransferManifest = {
  happ: { sha256: 'a'.repeat(64), size: 5 },
  ui: { sha256: 'b'.repeat(64), files: [{ path: 'index.html', size: 6, sha256: 'c'.repeat(64) }] },
  icon: 'icon',
  chunkSize: 4,
};
const stream = Uint8Array.from({ length: 11 }, (_, i) => i);
const fast: RequesterOptions = { offerTimeoutMs: 20, chunkTimeoutMs: 20, chunkAttempts: 2, window: 2, chunkSize: 4 };

/** A transport whose far side is scripted per peer. */
function scriptedTransport(behaviour: (to: AgentPubKey, m: ToolTransferMessage, reply: (r: ToolTransferMessage) => void) => void) {
  const listeners = new Set<(m: ToolTransferMessage) => void>();
  const transport: ToolTransferTransport = {
    send: async (to, m) => {
      // Deliver asynchronously like a real network would.
      setTimeout(() => behaviour(to, m, (r) => listeners.forEach((l) => l(r))), 0);
    },
    onMessage: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return transport;
}

function servesEverything(to: AgentPubKey, m: ToolTransferMessage, reply: (r: ToolTransferMessage) => void) {
  if (m.kind === 'request') reply({ kind: 'offer', requestId: m.requestId, manifest });
  if (m.kind === 'chunk-request') {
    const start = m.index * 4;
    reply({ kind: 'chunk', requestId: m.requestId, index: m.index, bytes: stream.slice(start, start + 4) });
  }
}

describe('requestToolFromPeers', () => {
  it('downloads and reassembles from the first peer, reporting progress', async () => {
    const events: RequesterEvent[] = [];
    const result = await requestToolFromPeers(scriptedTransport(servesEverything), me, [alice], request, (e) => events.push(e), fast);
    expect(result.peer).toBe(alice);
    expect(result.bytes).toEqual(stream);
    expect(result.manifest).toEqual(manifest);
    const progress = events.filter((e) => e.type === 'progress');
    expect(progress.length).toBe(streamLayout(manifest).chunkCount);
    expect(progress.at(-1)).toMatchObject({ chunksDone: 3, chunksTotal: 3 });
  });

  it('moves to the next peer when the first says unavailable or never answers', async () => {
    const events: RequesterEvent[] = [];
    const transport = scriptedTransport((to, m, reply) => {
      if (to === alice && m.kind === 'request') reply({ kind: 'unavailable', requestId: m.requestId, reason: 'no' });
      if (to === bob) servesEverything(to, m, reply);
    });
    const result = await requestToolFromPeers(transport, me, [alice, bob], request, (e) => events.push(e), fast);
    expect(result.peer).toBe(bob);
    expect(events.filter((e) => e.type === 'peer-failed').map((e) => e.peer)).toEqual([alice]);

    const silent = scriptedTransport((to, m, reply) => {
      if (to === bob) servesEverything(to, m, reply);
    });
    const r2 = await requestToolFromPeers(silent, me, [alice, bob], request, () => {}, fast);
    expect(r2.peer).toBe(bob);
  });

  it('retries a dropped chunk and gives up on a peer after repeated loss', async () => {
    let dropped = 0;
    const flaky = scriptedTransport((to, m, reply) => {
      if (m.kind === 'chunk-request' && m.index === 1 && dropped < 1) {
        dropped++;
        return;
      }
      servesEverything(to, m, reply);
    });
    const r = await requestToolFromPeers(flaky, me, [alice], request, () => {}, fast);
    expect(r.bytes).toEqual(stream);

    const alwaysDrops = scriptedTransport((to, m, reply) => {
      if (m.kind === 'chunk-request' && m.index === 1) return;
      servesEverything(to, m, reply);
    });
    await expect(requestToolFromPeers(alwaysDrops, me, [alice], request, () => {}, fast)).rejects.toThrow(/No peer/);
  });

  it('rejects an offer whose manifest does not match the request', async () => {
    const wrong = scriptedTransport((to, m, reply) => {
      if (m.kind === 'request') reply({ kind: 'offer', requestId: m.requestId, manifest: { ...manifest, happ: { ...manifest.happ, sha256: 'f'.repeat(64) } } });
    });
    const events: RequesterEvent[] = [];
    await expect(requestToolFromPeers(wrong, me, [alice], request, (e) => events.push(e), fast)).rejects.toThrow(/No peer/);
    expect(events.find((e) => e.type === 'peer-failed')).toMatchObject({ error: expect.stringMatching(/happ/) });
  });

  it('ignores replies carrying a foreign requestId', async () => {
    const noisy = scriptedTransport((to, m, reply) => {
      reply({ kind: 'offer', requestId: 'someone-else', manifest });
      servesEverything(to, m, reply);
    });
    const r = await requestToolFromPeers(noisy, me, [alice], request, () => {}, fast);
    expect(r.bytes).toEqual(stream);
  });

  it('fails immediately with no peers', async () => {
    await expect(requestToolFromPeers(scriptedTransport(() => {}), me, [], request, () => {}, fast)).rejects.toThrow(/No peer/);
  });
});
```

- [ ] **Step 6: Implement `requester.ts`**

```ts
import { AgentPubKey } from '@holochain/client';
import { ToolTransferManifest, ToolTransferMessage, ToolTransferRequest } from '@theweave/moss-types';
import { streamLayout, TOOL_TRANSFER_CHUNK_SIZE, validateToolTransferManifest } from '@theweave/utils';
import { ToolTransferTransport } from './transport';

export type RequesterOptions = {
  offerTimeoutMs: number;
  chunkTimeoutMs: number;
  chunkAttempts: number;
  window: number;
  chunkSize: number;
};

export const DEFAULT_REQUESTER_OPTIONS: RequesterOptions = {
  offerTimeoutMs: 10_000,
  chunkTimeoutMs: 15_000,
  chunkAttempts: 3,
  window: 4,
  chunkSize: TOOL_TRANSFER_CHUNK_SIZE,
};

export type RequesterEvent =
  | { type: 'requesting'; peer: AgentPubKey }
  | { type: 'progress'; peer: AgentPubKey; chunksDone: number; chunksTotal: number }
  | { type: 'peer-failed'; peer: AgentPubKey; error: string };

function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Waits for the first message that `match` accepts, or fails after `timeoutMs`.
 * Replies are matched on requestId, which the requester chose at random, so a
 * straggler from an abandoned attempt or an unrelated transfer is ignored.
 */
function waitFor<T extends ToolTransferMessage>(
  transport: ToolTransferTransport,
  match: (m: ToolTransferMessage) => m is T,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const unsub = transport.onMessage((m) => {
      if (!match(m)) return;
      clearTimeout(timer);
      unsub();
      resolve(m);
    });
  });
}

async function fetchChunk(
  transport: ToolTransferTransport,
  me: AgentPubKey,
  peer: AgentPubKey,
  requestId: string,
  request: ToolTransferRequest,
  index: number,
  options: RequesterOptions,
): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 0; attempt < options.chunkAttempts; attempt++) {
    const reply = waitFor(
      transport,
      (m): m is Extract<ToolTransferMessage, { kind: 'chunk' }> =>
        m.kind === 'chunk' && m.requestId === requestId && m.index === index,
      options.chunkTimeoutMs,
    );
    await transport.send(peer, { kind: 'chunk-request', requestId, from: me, index, ...request });
    try {
      return (await reply).bytes;
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`Chunk ${index} failed after ${options.chunkAttempts} attempts: ${lastError}`);
}

export async function requestToolFromPeer(
  transport: ToolTransferTransport,
  me: AgentPubKey,
  peer: AgentPubKey,
  request: ToolTransferRequest,
  onEvent: (event: RequesterEvent) => void,
  options: RequesterOptions = DEFAULT_REQUESTER_OPTIONS,
): Promise<{ manifest: ToolTransferManifest; bytes: Uint8Array }> {
  const requestId = newRequestId();
  onEvent({ type: 'requesting', peer });

  const answer = waitFor(
    transport,
    (m): m is Extract<ToolTransferMessage, { kind: 'offer' | 'unavailable' }> =>
      (m.kind === 'offer' || m.kind === 'unavailable') && m.requestId === requestId,
    options.offerTimeoutMs,
  );
  await transport.send(peer, { kind: 'request', requestId, from: me, ...request });
  const reply = await answer;
  if (reply.kind === 'unavailable') throw new Error(`Peer declined: ${reply.reason}`);

  const manifest = reply.manifest;
  const problem = validateToolTransferManifest(manifest, request);
  if (problem) throw new Error(problem);
  if (manifest.chunkSize !== options.chunkSize) {
    throw new Error(`Peer offered chunk size ${manifest.chunkSize}, expected ${options.chunkSize}`);
  }

  const layout = streamLayout(manifest);
  const bytes = new Uint8Array(layout.totalSize);
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < layout.chunkCount) {
      const index = next++;
      const chunk = await fetchChunk(transport, me, peer, requestId, request, index, options);
      const expectedLength = Math.min(options.chunkSize, layout.totalSize - index * options.chunkSize);
      if (chunk.length !== expectedLength) {
        throw new Error(`Chunk ${index} has ${chunk.length} bytes, expected ${expectedLength}`);
      }
      bytes.set(chunk, index * options.chunkSize);
      done++;
      onEvent({ type: 'progress', peer, chunksDone: done, chunksTotal: layout.chunkCount });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.window) }, worker));
  return { manifest, bytes };
}

export async function requestToolFromPeers(
  transport: ToolTransferTransport,
  me: AgentPubKey,
  peers: AgentPubKey[],
  request: ToolTransferRequest,
  onEvent: (event: RequesterEvent) => void,
  options: RequesterOptions = DEFAULT_REQUESTER_OPTIONS,
): Promise<{ manifest: ToolTransferManifest; bytes: Uint8Array; peer: AgentPubKey }> {
  for (const peer of peers) {
    try {
      const result = await requestToolFromPeer(transport, me, peer, request, onEvent, options);
      return { ...result, peer };
    } catch (e) {
      onEvent({ type: 'peer-failed', peer, error: e instanceof Error ? e.message : String(e) });
    }
  }
  throw new Error('No peer could provide the Tool');
}
```

Note on the window: when one worker throws, `Promise.all` rejects while sibling workers may still be awaiting a chunk; their `waitFor` timers will fire and reject into nothing. Add `.catch(() => {})`-free handling by having `fetchChunk` swallow nothing; the unhandled promise from the sibling `reply` is avoided because `waitFor`'s rejection is consumed inside `fetchChunk`'s try/catch. Verify in the test run that no "unhandled rejection" warning appears.

- [ ] **Step 7: Run requester tests**

Run: `npx vitest run src/renderer/src/groups/tool-transfer/`
Expected: PASS, no unhandled rejection warnings.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/groups/tool-transfer/
git commit -m "feat(renderer): provider and requester for peer Tool transfer"
```

---

### Task 5: Wire the transfer into `GroupStore`

**Files:**
- Create: `src/renderer/src/groups/tool-transfer/group-transport.ts`
- Modify: `src/renderer/src/groups/group-store.ts` (constructor ~line 192; signal dispatch ~line 348; new methods near `installApplet` ~line 1315; cleanup where `_groupSignalUnsub` is called)

**Interfaces:**
- Consumes: `GroupClient.remoteSignalArbitrary`, Task 4 functions, `window.electronAPI.*` from Task 3.
- Produces:
  - `class GroupToolTransferTransport implements ToolTransferTransport { constructor(groupClient: GroupClient); receive(message: ToolTransferMessage): void }`
  - `GroupStore.toolTransfer: GroupToolTransferTransport`
  - `GroupStore.onlineAppletPeers(appletHash: AppletHash): Promise<AgentPubKey[]>`
  - `GroupStore.fetchToolFromPeers(appletHash: AppletHash, applet: Applet, onEvent: (e: RequesterEvent) => void): Promise<AgentPubKey>` — pulls, stores via main, returns the peer that served.

- [ ] **Step 1: Write `group-transport.ts`**

```ts
import { AgentPubKey } from '@holochain/client';
import { GroupClient } from '@theweave/group-client';
import { ToolTransferMessage, ToolTransferRequest } from '@theweave/moss-types';
import { handleProviderMessage } from './provider';
import { ToolAssetReader, ToolTransferTransport } from './transport';

/**
 * Bridges the transfer protocol onto the group's arbitrary remote-signal
 * channel. Incoming messages fan out to whoever is waiting (the requester) and
 * to the stateless provider, which answers requests from local disk.
 */
export class GroupToolTransferTransport implements ToolTransferTransport {
  private listeners = new Set<(message: ToolTransferMessage) => void>();

  private reader: ToolAssetReader = {
    readManifest: (request: ToolTransferRequest, chunkSize: number) =>
      window.electronAPI.readToolAssetsManifest(request, chunkSize),
    readChunk: (request: ToolTransferRequest, index: number, chunkSize: number) =>
      window.electronAPI.readToolAssetsChunk(request, index, chunkSize),
  };

  constructor(private groupClient: GroupClient) {}

  async send(to: AgentPubKey, message: ToolTransferMessage): Promise<void> {
    await this.groupClient.remoteSignalArbitrary({ type: 'tool-transfer', payload: message }, [to]);
  }

  onMessage(listener: (message: ToolTransferMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  receive(message: ToolTransferMessage): void {
    this.listeners.forEach((l) => l(message));
    handleProviderMessage(message, this, this.reader).catch((e) =>
      console.warn(`[tool-transfer] provider failed to handle ${message.kind}: ${e}`),
    );
  }
}
```

- [ ] **Step 2: Wire into `GroupStore`**

In the constructor after `this.groupClient = ...`:

```ts
    this.toolTransfer = new GroupToolTransferTransport(this.groupClient);
```

Declare the field `toolTransfer: GroupToolTransferTransport;` next to `groupClient`.

In the `Arbitrary` signal handler add a branch:

```ts
        } else if (signalContent.type === 'tool-transfer') {
          this.toolTransfer.receive(signalContent.payload);
        }
```

Add the two methods near `installApplet`:

```ts
  /**
   * Members who have joined the applet and are currently reachable. Only they
   * can have the Tool's bytes, and only reachable ones can answer a transfer.
   */
  async onlineAppletPeers(appletHash: AppletHash): Promise<AgentPubKey[]> {
    const statuses = get(this._peerStatuses) ?? {};
    const myPubKeyB64 = encodeHashToBase64(this.groupClient.myPubKey);
    const joined = await this.groupClient.getJoinedAppletAgents(appletHash);
    return joined
      .map((a) => a.group_pubkey)
      .filter((pubkey) => {
        const b64 = encodeHashToBase64(pubkey);
        if (b64 === myPubKeyB64) return false;
        const status = statuses[b64]?.status;
        return status === 'online' || status === 'inactive';
      });
  }

  async fetchToolFromPeers(
    appletHash: AppletHash,
    applet: Applet,
    onEvent: (event: RequesterEvent) => void,
  ): Promise<AgentPubKey> {
    if (!applet.sha256_ui) throw new Error('Applet entry has no UI sha256; cannot fetch from peers.');
    const request: ToolTransferRequest = {
      happSha256: applet.sha256_happ,
      uiSha256: applet.sha256_ui,
      toolCompatibilityId: toolCompatibilityIdFromDistInfoString(applet.distribution_info),
    };
    const peers = await this.onlineAppletPeers(appletHash);
    const { manifest, bytes, peer } = await requestToolFromPeers(
      this.toolTransfer,
      this.groupClient.myPubKey,
      peers,
      request,
      onEvent,
    );
    await window.electronAPI.storeToolAssetsFromPeer(manifest, bytes, request);
    return peer;
  }
```

Check `getJoinedAppletAgents` signature in `shared/group-client/src/groupClient.ts:199` and pass `local` as it expects. Import `toolCompatibilityIdFromDistInfoString` from `@theweave/utils`, `requestToolFromPeers, RequesterEvent` from `./tool-transfer/requester`, `GroupToolTransferTransport` from `./tool-transfer/group-transport`, `ToolTransferRequest` from `@theweave/moss-types`.

- [ ] **Step 3: Typecheck**

Run: `yarn typecheck:web`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/groups/tool-transfer/group-transport.ts src/renderer/src/groups/group-store.ts
git commit -m "feat(group-store): relay peer Tool transfer over group remote signals"
```

---

### Task 6: Library-then-peers install with progress in `MossStore`

**Files:**
- Modify: `src/renderer/src/moss-store.ts` (`installApplet` at ~line 1334; new store field near other `writable` fields)

**Interfaces:**
- Consumes: `GroupStore.fetchToolFromPeers`, `AppletInstallProgress`, `installAppletBundle(..., assetSource)`.
- Produces:
  - `MossStore.appletInstallProgress: Writable<Record<AppletId, AppletInstallProgress>>`
  - `MossStore.installApplet(appletHash, applet, groupStore?: GroupStore): Promise<AppInfo>` — same contract, now falls back to peers when `groupStore` is provided.

- [ ] **Step 1: Add the progress store and helper**

```ts
  appletInstallProgress: Writable<Record<AppletId, AppletInstallProgress>> = writable({});

  private setInstallProgress(appletId: AppletId, progress: AppletInstallProgress | undefined): void {
    this.appletInstallProgress.update((all) => {
      const next = { ...all };
      if (progress) next[appletId] = progress;
      else delete next[appletId];
      return next;
    });
  }
```

- [ ] **Step 2: Restructure `installApplet`**

Extract the existing web2 resolution (the block that fetches the tool list and computes `appHashes` / `happOrWebhappUrl` / `uiPort`, including the dev-config branch) into

```ts
  private async resolveToolLibraryInstall(
    applet: Applet,
    distributionInfo: Extract<DistributionInfo, { type: 'web2-tool-list' }>,
  ): Promise<{ appHashes: AppHashes; happOrWebhappUrl: string; uiPort?: number }>
```

Give the tool-list fetch a bounded wait so an offline machine fails fast:

```ts
        const resp = await fetch(distributionInfo.info.toolListUrl, {
          cache: 'no-cache',
          signal: AbortSignal.timeout(TOOL_LIST_FETCH_TIMEOUT_MS),
        });
```

with `const TOOL_LIST_FETCH_TIMEOUT_MS = 10_000;` at module top.

Extract the roles-settings construction into `private rolesSettingsFor(applet: Applet): RoleSettingsMap`.

New `installApplet`:

```ts
  async installApplet(appletHash: EntryHash, applet: Applet, groupStore?: GroupStore): Promise<AppInfo> {
    const appletId = encodeHashToBase64(appletHash);
    const appId = appIdFromAppletHash(appletHash);
    if (!applet.network_seed) {
      throw new Error('Network Seed not defined. Undefined network seed is currently not supported.');
    }
    const distributionInfo: DistributionInfo = JSON.parse(applet.distribution_info);
    Value.Assert(TDistributionInfo, distributionInfo);
    if (distributionInfo.type !== 'web2-tool-list') {
      throw new Error("Distribution info types other than 'web2-tool-list' are currently not supported.");
    }
    const roles_settings = this.rolesSettingsFor(applet);

    try {
      this.setInstallProgress(appletId, { phase: 'library' });
      const { appHashes, happOrWebhappUrl, uiPort } = await this.resolveToolLibraryInstall(applet, distributionInfo);
      if (appHashes.type !== 'webhapp' && !this.isAppletDev) {
        throw new Error(`Got invalid AppHashes type: ${appHashes.type}. AppHashes: ${appHashes}`);
      }
      this.setInstallProgress(appletId, { phase: 'installing' });
      const appInfo = await window.electronAPI.installAppletBundle(
        appId, applet.network_seed, happOrWebhappUrl, distributionInfo, appHashes, uiPort, roles_settings,
      );
      this.setInstallProgress(appletId, { phase: 'done' });
      return appInfo;
    } catch (libraryError) {
      const libraryMessage = libraryError instanceof Error ? libraryError.message : String(libraryError);
      console.warn(`Installing from the tool library failed: ${libraryMessage}`);
      if (!groupStore) {
        this.setInstallProgress(appletId, { phase: 'failed', error: libraryMessage });
        throw libraryError;
      }
      this.setInstallProgress(appletId, { phase: 'library-failed', error: libraryMessage });
      try {
        return await this.installAppletFromPeers(appletHash, applet, groupStore, distributionInfo, roles_settings);
      } catch (peerError) {
        const peerMessage = peerError instanceof Error ? peerError.message : String(peerError);
        this.setInstallProgress(appletId, { phase: 'failed', error: peerMessage });
        throw new Error(`Tool library: ${libraryMessage}. Group members: ${peerMessage}`);
      }
    } finally {
      // Leave the terminal state visible briefly so the UI can show it, then clear.
      setTimeout(() => this.setInstallProgress(appletId, undefined), 4000);
    }
  }

  private async installAppletFromPeers(
    appletHash: EntryHash,
    applet: Applet,
    groupStore: GroupStore,
    distributionInfo: DistributionInfo,
    roles_settings: RoleSettingsMap,
  ): Promise<AppInfo> {
    const appletId = encodeHashToBase64(appletHash);
    const appId = appIdFromAppletHash(appletHash);
    if (!applet.sha256_ui || !applet.sha256_webhapp) {
      throw new Error('Applet entry lacks UI or webhapp hashes.');
    }
    this.setInstallProgress(appletId, { phase: 'peer-search' });
    const peers = await groupStore.onlineAppletPeers(appletHash);
    if (peers.length === 0) {
      this.setInstallProgress(appletId, { phase: 'peer-none' });
      throw new Error('No online group member has this Tool.');
    }
    await groupStore.fetchToolFromPeers(appletHash, applet, (event) => {
      const peer = encodeHashToBase64(event.peer);
      switch (event.type) {
        case 'requesting':
          this.setInstallProgress(appletId, { phase: 'peer-request', peer });
          break;
        case 'progress':
          this.setInstallProgress(appletId, {
            phase: 'peer-download', peer, chunksDone: event.chunksDone, chunksTotal: event.chunksTotal,
          });
          break;
        case 'peer-failed':
          this.setInstallProgress(appletId, { phase: 'peer-failed', peer, error: event.error });
          break;
      }
    });
    this.setInstallProgress(appletId, { phase: 'installing' });
    const appHashes: AppHashes = {
      type: 'webhapp',
      sha256: applet.sha256_webhapp,
      happ: { sha256: applet.sha256_happ },
      ui: { sha256: applet.sha256_ui },
    };
    const appInfo = await window.electronAPI.installAppletBundle(
      appId, applet.network_seed!, '', distributionInfo, appHashes, undefined, roles_settings, { type: 'peer' },
    );
    this.setInstallProgress(appletId, { phase: 'done' });
    return appInfo;
  }
```

`fetchToolFromPeers` computes candidates itself; `installAppletFromPeers` also asks first so it can report `peer-none` before any request goes out. The duplicate call is cheap (a local zome query).

- [ ] **Step 3: Pass the group store from `GroupStore.installApplet`**

In `src/renderer/src/groups/group-store.ts` `installApplet`, change `await this.mossStore.installApplet(appletHash, applet)` to `await this.mossStore.installApplet(appletHash, applet, this)`.

- [ ] **Step 4: Typecheck and run the unit suite**

Run: `yarn typecheck && yarn test:unit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/moss-store.ts src/renderer/src/groups/group-store.ts
git commit -m "feat(install): fall back to group members when the tool library is unreachable"
```

---

### Task 7: Progress UI element and localization

**Files:**
- Create: `src/renderer/src/groups/elements/applet-install-progress.ts`
- Modify: `src/renderer/src/groups/elements/group-home.ts` (card footer, ~line 752; imports)
- Modify: `src/renderer/src/app/dialogs/tool-info-dialog.ts` (beneath the Activate button; imports)
- Modify: `src/renderer/xliff/{de,fr,es,tr,it,pt,ja,nl}.xlf` via `lit-localize extract` then hand translation; regenerate `src/renderer/src/locales/generated/`

**Interfaces:**
- Consumes: `MossStore.appletInstallProgress`, `GroupStore.profilesStore.profiles.get(agent)`.
- Produces: `<applet-install-progress .appletHash=${EntryHash} .groupStore=${GroupStore}>`; renders nothing when there is no progress entry for the applet.

- [ ] **Step 1: Write the element**

```ts
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { localized, msg, str } from '@lit/localize';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { AgentPubKeyB64, EntryHash, decodeHashFromBase64, encodeHashToBase64 } from '@holochain/client';
import { AppletInstallProgress } from '@theweave/moss-types';
import { derived } from '@holochain-open-dev/stores';

import '@shoelace-style/shoelace/dist/components/progress-bar/progress-bar.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';

import { mossStoreContext } from '../../context';
import { MossStore } from '../../moss-store';
import { GroupStore } from '../group-store';

/**
 * Shows what an in-flight Tool install is doing right now: which source is
 * being tried, which member is serving, and how far the transfer has come.
 */
@localized()
@customElement('applet-install-progress')
export class AppletInstallProgressElement extends LitElement {
  @consume({ context: mossStoreContext })
  mossStore!: MossStore;

  @property() appletHash!: EntryHash;
  @property() groupStore: GroupStore | undefined;

  private progress = new StoreSubscriber(
    this,
    () =>
      derived(this.mossStore.appletInstallProgress, (all) =>
        this.appletHash ? all[encodeHashToBase64(this.appletHash)] : undefined,
      ),
    () => [this.appletHash, this.mossStore],
  );

  private peerName = new StoreSubscriber(
    this,
    () => {
      const peer = this.currentPeer();
      if (!peer || !this.groupStore) return undefined;
      return this.groupStore.profilesStore.profiles.get(decodeHashFromBase64(peer));
    },
    () => [this.currentPeer(), this.groupStore],
  );

  private currentPeer(): AgentPubKeyB64 | undefined {
    const p = this.progress.value;
    return p && 'peer' in p ? p.peer : undefined;
  }

  private displayName(): string {
    const peer = this.currentPeer();
    const profile = this.peerName.value;
    if (profile && profile.status === 'complete' && profile.value) return profile.value.entry.nickname;
    return peer ? `${peer.slice(0, 8)}…` : '';
  }

  private line(p: AppletInstallProgress): string {
    const name = this.displayName();
    switch (p.phase) {
      case 'library': return msg('Downloading from the tool library…');
      case 'library-failed': return msg('Tool library unreachable. Looking for group members who have this Tool…');
      case 'peer-search': return msg('Looking for group members who have this Tool…');
      case 'peer-none': return msg('No online group member has this Tool.');
      case 'peer-request': return msg(str`Requesting Tool from ${name}…`);
      case 'peer-download': return msg(str`Receiving from ${name}…`);
      case 'peer-failed': return msg(str`Transfer from ${name} failed. Trying the next member…`);
      case 'installing': return msg('Installing…');
      case 'done': return msg('Tool installed.');
      case 'failed': return msg('Installation failed.');
    }
  }

  render() {
    const p = this.progress.value;
    if (!p) return nothing;
    const busy = !['done', 'failed', 'peer-none'].includes(p.phase);
    return html`
      <div class="row ${p.phase === 'failed' || p.phase === 'peer-none' ? 'error' : ''}">
        ${busy ? html`<sl-spinner></sl-spinner>` : nothing}
        <span>${this.line(p)}</span>
      </div>
      ${p.phase === 'peer-download'
        ? html`
            <sl-progress-bar value=${Math.round((100 * p.chunksDone) / Math.max(1, p.chunksTotal))}>
              ${p.chunksDone} / ${p.chunksTotal}
            </sl-progress-bar>
          `
        : nothing}
    `;
  }

  static styles = css`
    :host { display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
    .row { display: flex; align-items: center; gap: 8px; }
    .error { color: var(--sl-color-danger-600); }
    sl-progress-bar { --height: 10px; }
  `;
}
```

Check the actual context symbol name in `src/renderer/src/context.ts` (search for `mossStoreContext`) and the `StoreSubscriber` constructor arity used elsewhere in `groups/elements` before finalizing.

- [ ] **Step 2: Mount it in `group-home.ts`**

Inside the unjoined-applet card, after the `.card-footer` div (still inside the card), add:

```ts
                          ${this._joiningNewApplet === encodeHashToBase64(info.appletHash)
                            ? html`<applet-install-progress
                                style="margin-top: 10px;"
                                .appletHash=${info.appletHash}
                                .groupStore=${this._groupStore}
                              ></applet-install-progress>`
                            : html``}
```

Add `import './applet-install-progress.js';` (match the import style of the neighbouring element imports in that file).

- [ ] **Step 3: Mount it in `tool-info-dialog.ts`**

Beneath the Activate button render block, when `this._activating` and `this._activateContext`, render:

```ts
            <applet-install-progress
              style="margin-top: 10px;"
              .appletHash=${this._activateContext.appletHash}
              .groupStore=${this._activateGroupStore}
            ></applet-install-progress>
```

Capture the group store in `_activate()` into a `@state() private _activateGroupStore: GroupStore | undefined` before calling `installApplet`, and clear it in the `finally`.

- [ ] **Step 4: Extract strings, translate, build**

```bash
cd src/renderer && npx lit-localize extract
```

Fill the new `<trans-unit>` targets in all eight `.xlf` files. Translations:

| en | de | fr | es | tr | it | pt | ja | nl |
|---|---|---|---|---|---|---|---|---|
| Downloading from the tool library… | Wird aus der Tool-Bibliothek heruntergeladen… | Téléchargement depuis la bibliothèque d'outils… | Descargando desde la biblioteca de herramientas… | Araç kitaplığından indiriliyor… | Download dalla libreria degli strumenti… | A transferir da biblioteca de ferramentas… | ツールライブラリからダウンロード中… | Downloaden uit de toolbibliotheek… |
| Tool library unreachable. Looking for group members who have this Tool… | Tool-Bibliothek nicht erreichbar. Suche nach Gruppenmitgliedern mit diesem Tool… | Bibliothèque d'outils inaccessible. Recherche de membres du groupe possédant cet outil… | Biblioteca de herramientas inaccesible. Buscando miembros del grupo que tengan esta herramienta… | Araç kitaplığına ulaşılamıyor. Bu araca sahip grup üyeleri aranıyor… | Libreria degli strumenti non raggiungibile. Ricerca di membri del gruppo che hanno questo strumento… | Biblioteca de ferramentas inacessível. A procurar membros do grupo que tenham esta ferramenta… | ツールライブラリに接続できません。このツールを持つグループメンバーを探しています… | Toolbibliotheek onbereikbaar. Zoeken naar groepsleden die deze tool hebben… |
| Looking for group members who have this Tool… | Suche nach Gruppenmitgliedern mit diesem Tool… | Recherche de membres du groupe possédant cet outil… | Buscando miembros del grupo que tengan esta herramienta… | Bu araca sahip grup üyeleri aranıyor… | Ricerca di membri del gruppo che hanno questo strumento… | A procurar membros do grupo que tenham esta ferramenta… | このツールを持つグループメンバーを探しています… | Zoeken naar groepsleden die deze tool hebben… |
| No online group member has this Tool. | Kein Gruppenmitglied online hat dieses Tool. | Aucun membre du groupe en ligne ne possède cet outil. | Ningún miembro del grupo en línea tiene esta herramienta. | Çevrimiçi hiçbir grup üyesinde bu araç yok. | Nessun membro del gruppo online ha questo strumento. | Nenhum membro do grupo online tem esta ferramenta. | オンラインのグループメンバーでこのツールを持つ人はいません。 | Geen online groepslid heeft deze tool. |
| Requesting Tool from {name}… | Tool wird von {name} angefordert… | Demande de l'outil à {name}… | Solicitando la herramienta a {name}… | Araç {name} kişisinden isteniyor… | Richiesta dello strumento a {name}… | A pedir a ferramenta a {name}… | {name} にツールをリクエスト中… | Tool opvragen bij {name}… |
| Receiving from {name}… | Empfang von {name}… | Réception depuis {name}… | Recibiendo de {name}… | {name} kişisinden alınıyor… | Ricezione da {name}… | A receber de {name}… | {name} から受信中… | Ontvangen van {name}… |
| Transfer from {name} failed. Trying the next member… | Übertragung von {name} fehlgeschlagen. Nächstes Mitglied wird versucht… | Échec du transfert depuis {name}. Essai avec le membre suivant… | Falló la transferencia desde {name}. Probando con el siguiente miembro… | {name} kişisinden aktarım başarısız oldu. Sonraki üye deneniyor… | Trasferimento da {name} non riuscito. Tentativo con il membro successivo… | A transferência de {name} falhou. A tentar o próximo membro… | {name} からの転送に失敗しました。次のメンバーを試しています… | Overdracht van {name} mislukt. Volgend lid wordt geprobeerd… |
| Installing… | Wird installiert… | Installation… | Instalando… | Yükleniyor… | Installazione… | A instalar… | インストール中… | Installeren… |
| Installation failed. | Installation fehlgeschlagen. | Échec de l'installation. | La instalación falló. | Yükleme başarısız oldu. | Installazione non riuscita. | A instalação falhou. | インストールに失敗しました。 | Installatie mislukt. |

`Tool installed.` already exists in the catalog; reuse it. In the `.xlf` files `{name}` appears as an `<x id="0" equiv-text="${name}"/>` placeholder; keep the placeholder element and translate the surrounding text.

```bash
cd src/renderer && npx lit-localize build && cd ../.. && yarn typecheck:web
```

- [ ] **Step 5: Run unit tests and typecheck**

Run: `yarn test:unit && yarn typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/groups/elements/applet-install-progress.ts src/renderer/src/groups/elements/group-home.ts src/renderer/src/app/dialogs/tool-info-dialog.ts src/renderer/xliff src/renderer/src/locales/generated
git commit -m "feat(ui): show install progress including transfers from group members"
```

---

### Task 8: Manual two-agent verification and status update

**Files:**
- Modify: `plans/peer-tool-transfer.md` (Status line; record the measured chunk ceiling)

- [ ] **Step 1: Build and launch two agents**

```bash
yarn build && yarn applet-dev-example
```

Agent 1 creates the group and installs the example Tool. Agent 2 joins the group. Confirm both show each other online in the group sidebar.

- [ ] **Step 2: Force the library path to fail for agent 2**

Fastest lever: in agent 2's process only, block the tool list host. On Linux: `sudo iptables -A OUTPUT -m owner --uid-owner $(id -u) -d <tool-list-host> -j REJECT` is too broad (both agents share the uid). Instead temporarily edit `weave.dev.config.example.ts` so the dev applet's `toolListUrl`-derived source is unreachable for the second launch, or simply disconnect the machine's network after both agents are up and peer statuses are known (mDNS build keeps them connected on LAN).

- [ ] **Step 3: Activate the Tool on agent 2 and observe**

Expected progress line sequence beneath the Activate button: library → library unreachable → requesting from `<agent 1 name>` → receiving with progress bar → installing → Tool installed toast. The applet opens and renders its UI.

Check the main-process log for `[tool-transfer]` warnings; there should be none.

- [ ] **Step 4: Probe the chunk ceiling**

Temporarily set `TOOL_TRANSFER_CHUNK_SIZE` to 4 MiB, rebuild, repeat Step 3. If it succeeds, note the value in the spec under "The byte stream" and decide whether to raise the default; if it fails, note the failure mode. Restore 512 KiB unless raising it.

- [ ] **Step 5: Update the spec status and commit**

Set `Status:` in `plans/peer-tool-transfer.md` to "implemented 2026-09-03; manual two-agent test passed" and record the chunk measurement.

```bash
git add plans/peer-tool-transfer.md
git commit -m "docs(plans): record peer tool transfer verification and chunk measurement"
```

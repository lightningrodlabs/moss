import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { streamLayout } from '@theweave/utils';
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
const ICON = 'data:image/png;base64,AAAA';

function dirsUnder(base: string): ToolAssetDirs {
  return {
    happsDir: path.join(base, 'happs'),
    uisDir: path.join(base, 'uis'),
    toolsDir: path.join(base, 'tools'),
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-tool-assets-'));
  dirs = dirsUnder(root);
  fs.mkdirSync(dirs.happsDir, { recursive: true });
  fs.writeFileSync(path.join(dirs.happsDir, `${HAPP}.happ`), happ);
  for (const [rel, bytes] of Object.entries(files)) {
    const p = path.join(dirs.uisDir, UI, 'assets', rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, bytes);
  }
  fs.mkdirSync(path.join(dirs.toolsDir, TOOL), { recursive: true });
  fs.writeFileSync(path.join(dirs.toolsDir, TOOL, 'icon'), ICON, 'utf-8');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('readToolAssetsManifest', () => {
  it('lists files sorted by path with sizes and hashes', async () => {
    const m = await readToolAssetsManifest(dirs, request, 1024);
    expect(m).toBeDefined();
    expect(m!.happ).toEqual({ sha256: HAPP, size: happ.length });
    expect(m!.ui.sha256).toBe(UI);
    expect(m!.ui.files.map((f) => f.path)).toEqual([
      'assets/app.js',
      'index.html',
      'weave.config.json',
    ]);
    expect(m!.ui.files[1]).toEqual({
      path: 'index.html',
      size: files['index.html'].length,
      sha256: sha(files['index.html']),
    });
    expect(m!.icon).toBe(ICON);
    expect(m!.chunkSize).toBe(1024);
  });

  it('returns undefined when the happ, UI or icon is missing', async () => {
    expect(
      await readToolAssetsManifest(dirs, { ...request, happSha256: 'f'.repeat(64) }, 1024),
    ).toBeUndefined();
    expect(
      await readToolAssetsManifest(dirs, { ...request, uiSha256: 'f'.repeat(64) }, 1024),
    ).toBeUndefined();
    expect(
      await readToolAssetsManifest(dirs, { ...request, toolCompatibilityId: 'nope' }, 1024),
    ).toBeUndefined();
  });

  it('refuses request fields that could escape the asset directories', async () => {
    await expect(
      readToolAssetsManifest(dirs, { ...request, happSha256: '../x' }, 1024),
    ).rejects.toThrow();
    await expect(
      readToolAssetsManifest(dirs, { ...request, uiSha256: HAPP.toUpperCase() }, 1024),
    ).rejects.toThrow();
    await expect(
      readToolAssetsManifest(dirs, { ...request, toolCompatibilityId: '../x' }, 1024),
    ).rejects.toThrow();
  });
});

describe('readToolAssetsChunk + storeToolAssetsFromPeer', () => {
  it('serves chunks that reassemble into the original files on another machine', async () => {
    const m = (await readToolAssetsManifest(dirs, request, 1024))!;
    const layout = streamLayout(m);
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < layout.chunkCount; i++) {
      chunks.push(await readToolAssetsChunk(dirs, request, i, 1024));
    }
    expect(chunks.slice(0, -1).every((c) => c.length === 1024)).toBe(true);
    const stream = new Uint8Array(layout.totalSize);
    chunks.forEach((c, i) => stream.set(c, i * 1024));

    const target = dirsUnder(path.join(root, 'b'));
    await storeToolAssetsFromPeer(target, m, stream, request);
    expect(fs.readFileSync(path.join(target.happsDir, `${HAPP}.happ`))).toEqual(Buffer.from(happ));
    for (const [rel, bytes] of Object.entries(files)) {
      expect(fs.readFileSync(path.join(target.uisDir, UI, 'assets', rel))).toEqual(
        Buffer.from(bytes),
      );
    }
    expect(fs.readFileSync(path.join(target.toolsDir, TOOL, 'icon'), 'utf-8')).toBe(ICON);
  });

  it('writes nothing when the happ hash does not match', async () => {
    const m = (await readToolAssetsManifest(dirs, request, 1024))!;
    const stream = new Uint8Array(streamLayout(m).totalSize);
    const target = dirsUnder(path.join(root, 'c'));
    await expect(storeToolAssetsFromPeer(target, m, stream, request)).rejects.toThrow(/happ/);
    expect(fs.existsSync(target.happsDir)).toBe(false);
    expect(fs.existsSync(target.uisDir)).toBe(false);
  });

  it('writes nothing when a UI file does not match its manifest hash', async () => {
    const m = (await readToolAssetsManifest(dirs, request, 1024))!;
    const layout = streamLayout(m);
    const stream = new Uint8Array(layout.totalSize);
    for (let i = 0; i < layout.chunkCount; i++) {
      stream.set(await readToolAssetsChunk(dirs, request, i, 1024), i * 1024);
    }
    stream[layout.totalSize - 1] ^= 0xff;
    const target = dirsUnder(path.join(root, 'd'));
    await expect(storeToolAssetsFromPeer(target, m, stream, request)).rejects.toThrow(
      /weave.config.json/,
    );
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

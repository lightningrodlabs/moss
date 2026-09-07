import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ToolTransferFile, ToolTransferManifest, ToolTransferRequest } from '@theweave/moss-types';
import {
  chunkReads,
  isSafePathSegment,
  isSha256Hex,
  splitStream,
  streamLayout,
  validateToolTransferManifest,
} from '@theweave/utils';

/**
 * Serving and storing a Tool's assets for transfer between group members.
 *
 * Everything here works directly on the canonical asset directories, so a
 * member can hand a Tool to a peer without keeping any extra copy of it, and
 * a received Tool lands exactly where a library download would have put it.
 */

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
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(path.join(dir, entry.name), rel)));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

async function sha256File(p: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const piece of fs.createReadStream(p)) hash.update(piece as Buffer);
  return hash.digest('hex');
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
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
    files.push({
      path: rel,
      size: (await fsPromises.stat(abs)).size,
      sha256: await sha256File(abs),
    });
  }
  return {
    happ: { sha256: request.happSha256, size: happSize },
    ui: { sha256: request.uiSha256, files },
    icon: await fsPromises.readFile(icon, 'utf-8'),
    chunkSize,
  };
}

/**
 * Whether this computer already holds everything an install of that Tool needs:
 * the happ, the unpacked UI, and the icon. All three matter, because the
 * installer treats a missing icon as fatal and would try to fetch it.
 */
export function toolAssetsPresent(dirs: ToolAssetDirs, request: ToolTransferRequest): boolean {
  assertRequestIsSafe(request);
  return (
    fs.existsSync(happPath(dirs, request)) &&
    fs.existsSync(uiAssetsDir(dirs, request)) &&
    fs.existsSync(iconPath(dirs, request))
  );
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
  const out = new Uint8Array(pieces.reduce((n, piece) => n + piece.length, 0));
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }
  return out;
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
  files.forEach((file, i) => {
    if (sha256Bytes(file.bytes) !== manifest.ui.files[i].sha256) {
      throw new Error(`Received bytes for ${file.path} do not match the manifest sha256`);
    }
  });

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

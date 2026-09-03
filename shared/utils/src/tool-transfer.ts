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

/** A read of `length` bytes starting `offset` bytes into one segment. */
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
    const from = Math.max(start, offset);
    const to = Math.min(end, offset + size);
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

/**
 * Returns a human-readable problem, or undefined when the manifest is safe to
 * act on and describes the Tool that was asked for.
 */
export function validateToolTransferManifest(
  manifest: ToolTransferManifest,
  expected: { happSha256: string; uiSha256: string },
): string | undefined {
  if (manifest.happ.sha256 !== expected.happSha256)
    return 'Manifest happ sha256 does not match the requested Tool';
  if (manifest.ui.sha256 !== expected.uiSha256)
    return 'Manifest UI sha256 does not match the requested Tool';
  if (!Number.isInteger(manifest.chunkSize) || manifest.chunkSize <= 0)
    return 'Manifest chunk size must be a positive integer';
  if (!Number.isInteger(manifest.happ.size) || manifest.happ.size <= 0)
    return 'Manifest happ size must be a positive integer';
  if (typeof manifest.icon !== 'string' || manifest.icon.length === 0)
    return 'Manifest icon is missing';
  if (!Array.isArray(manifest.ui.files) || manifest.ui.files.length === 0)
    return 'Manifest lists no UI files';
  let total = manifest.happ.size;
  const seen = new Set<string>();
  for (const file of manifest.ui.files) {
    if (!isSafeRelativePath(file.path))
      return `Unsafe file path in manifest: ${JSON.stringify(file.path)}`;
    if (seen.has(file.path)) return `Duplicate file path in manifest: ${file.path}`;
    seen.add(file.path);
    if (!Number.isInteger(file.size) || file.size < 0) return `Invalid size for ${file.path}`;
    if (!isSha256Hex(file.sha256)) return `Invalid sha256 for ${file.path}`;
    total += file.size;
  }
  if (total > TOOL_TRANSFER_MAX_TOTAL_BYTES) return `Manifest total of ${total} bytes is too large`;
  return undefined;
}

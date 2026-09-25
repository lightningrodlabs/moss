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

function manifest(
  files: Array<[string, number]>,
  happSize: number,
  chunkSize: number,
): ToolTransferManifest {
  return {
    happ: { sha256: H, size: happSize },
    ui: {
      sha256: U,
      files: files.map(([path, size]) => ({ path, size, sha256: 'c'.repeat(64) })),
    },
    icon: 'data:image/png;base64,AAAA',
    chunkSize,
  };
}

describe('streamLayout', () => {
  it('lays out the happ first, then files in manifest order, and counts chunks', () => {
    const layout = streamLayout(
      manifest(
        [
          ['index.html', 5],
          ['assets/a.js', 7],
        ],
        10,
        8,
      ),
    );
    expect(layout.totalSize).toBe(22);
    expect(layout.chunkCount).toBe(3);
    expect(layout.segments.map((s) => s.offset)).toEqual([0, 10, 15]);
  });
  it('has zero chunks for an empty stream', () => {
    expect(streamLayout(manifest([], 0, 8)).chunkCount).toBe(0);
  });
});

describe('chunkReads', () => {
  const layout = streamLayout(
    manifest(
      [
        ['index.html', 5],
        ['assets/a.js', 7],
      ],
      10,
      8,
    ),
  );
  it('spans segment boundaries and clips the final chunk', () => {
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
    expect(() => chunkReads(layout, 3)).toThrow();
    expect(() => chunkReads(layout, -1)).toThrow();
    expect(() => chunkReads(layout, 1.5)).toThrow();
  });
});

describe('splitStream', () => {
  const layout = streamLayout(
    manifest(
      [
        ['index.html', 5],
        ['assets/a.js', 7],
      ],
      10,
      8,
    ),
  );
  it('round-trips bytes through chunking and reassembly', () => {
    const happ = Uint8Array.from({ length: 10 }, (_, i) => i);
    const a = Uint8Array.from({ length: 5 }, (_, i) => 100 + i);
    const b = Uint8Array.from({ length: 7 }, (_, i) => 200 + i);
    const stream = new Uint8Array([...happ, ...a, ...b]);
    const parts = splitStream(layout, stream);
    expect(parts.happ).toEqual(happ);
    expect(parts.files).toEqual([
      { path: 'index.html', bytes: a },
      { path: 'assets/a.js', bytes: b },
    ]);
  });
  it('rejects a stream whose length does not match the layout', () => {
    expect(() => splitStream(layout, new Uint8Array(21))).toThrow();
  });
});

describe('isSafeRelativePath', () => {
  it.each(['index.html', 'assets/a.js', 'a/b/c.txt', 'weave.config.json'])('accepts %s', (p) => {
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
    expect(
      validateToolTransferManifest(manifest([['index.html', 5]], 10, 8), expected),
    ).toBeUndefined();
  });
  it('rejects hash mismatches', () => {
    expect(
      validateToolTransferManifest(manifest([['a', 1]], 1, 8), {
        ...expected,
        happSha256: 'f'.repeat(64),
      }),
    ).toMatch(/happ/);
    expect(
      validateToolTransferManifest(manifest([['a', 1]], 1, 8), {
        ...expected,
        uiSha256: 'f'.repeat(64),
      }),
    ).toMatch(/UI/);
  });
  it('rejects unsafe paths, bad sizes, bad file hashes, oversize totals and bad chunk sizes', () => {
    expect(validateToolTransferManifest(manifest([['../x', 1]], 1, 8), expected)).toMatch(/path/);
    expect(validateToolTransferManifest(manifest([['a', -1]], 1, 8), expected)).toMatch(/size/);
    const m = manifest([['a', 1]], 1, 8);
    m.ui.files[0].sha256 = 'nope';
    expect(validateToolTransferManifest(m, expected)).toMatch(/sha256/);
    expect(
      validateToolTransferManifest(manifest([['a', 300 * 1024 * 1024]], 1, 8), expected),
    ).toMatch(/large/);
    expect(validateToolTransferManifest(manifest([['a', 1]], 1, 0), expected)).toMatch(/chunk/);
  });
  it('rejects an empty file list and duplicate paths', () => {
    expect(validateToolTransferManifest(manifest([], 1, 8), expected)).toMatch(/no UI files/);
    expect(
      validateToolTransferManifest(
        manifest(
          [
            ['a', 1],
            ['a', 1],
          ],
          1,
          8,
        ),
        expected,
      ),
    ).toMatch(/uplicate/);
  });
});

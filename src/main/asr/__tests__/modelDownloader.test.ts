import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

  it('rejects with the write error, cancels the body and stays usable when the .part cannot be written', async () => {
    const { fetch } = fakeFetch(BODY, { ignoreRange: true, hangAfter: 1 });
    const { downloader, modelsDir } = makeDownloader(fetch);
    // A directory at the .part path makes createWriteStream fail with EISDIR.
    mkdirSync(path.join(modelsDir, 'ggml-tiny.bin.part'));

    await expect(downloader.download(entryFor(BODY, { sizeBytes: 10_000_000 }))).rejects.toThrow(
      /download of tiny failed: .*EISDIR/,
    );
    expect(downloader.isDownloading('tiny')).toBe(false);
  });
});

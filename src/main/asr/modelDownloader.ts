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
    const reader = res.body.getReader();
    // A failed write (disk full, unwritable path) surfaces as a stream
    // 'error' event that nothing awaits while the loop is blocked on the
    // network. Capture it and cancel the reader so the loop wakes up and
    // the failure becomes a rejected download.
    let writeError: Error | undefined;
    out.on('error', (err) => {
      writeError ??= err;
      reader.cancel().catch(() => {});
    });
    report(true);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (!out.write(value)) await once(out, 'drain');
        report(false);
      }
      if (writeError) throw writeError;
    } catch (err) {
      await reader.cancel().catch(() => {});
      await closeStream(out);
      if (signal.aborted && !writeError) return 'cancelled';
      throw new Error(`download of ${entry.id} failed: ${(writeError ?? (err as Error)).message}`);
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
  if (out.destroyed) return Promise.resolve();
  return new Promise((resolve) => out.end(() => resolve()));
}

async function sha256OfFile(p: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(p), hash);
  return hash.digest('hex');
}

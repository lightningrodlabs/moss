// AsrSession — caller pushes PCM16 chunks, listens for final-segment
// events. Sits on top of a WhisperServer obtained from the broker.
//
// Chunking strategy:
//   1. Caller-driven: pass `endOfUtterance: true` when their own VAD
//      (or end-of-file) signals an utterance boundary.
//   2. Moss-driven energy VAD (default on): per-chunk RMS detects
//      silence-after-speech and triggers a flush after `vadSilenceMs`
//      of continuous silence. Tunable thresholds — see VAD_DEFAULTS.
//   3. Safety cap: if neither of the above ever fires, force-flush
//      after `maxBufferMs` of accumulated audio.
//
// Energy VAD vs ML VAD: this is fixed-threshold RMS, not Silero / not
// whisper-vad-speech-segments. Pragmatic for v1 — no extra binary, no
// per-buffer process spawn, runs in microseconds. If real-world
// environments show this misfires (noisy rooms tripping the threshold,
// quiet voices getting cut off), the upgrade path is to swap the
// `updateVad` body for an ML model without changing the public
// pushAudio contract.
//
// No partial events in v1 — the M0 spike showed they cost a full
// encoder pass per chunk and quality is poor. M2/M3 can add a partials
// path with proper ML VAD chunking when there's a consumer that needs
// them.
//
// pushAudio() never waits on inference: callers pump live audio from a
// bounded capture queue, so a push that blocked for a whole transcribe
// would drop the frames spoken meanwhile.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { AsrFinalEvent, AsrSessionOptions } from '@theweave/api';

import { AsrSegment, AsrTranscribeResult, WhisperServerState } from './types';
import { WhisperServer } from './whisperServer';
import { pcm16ToWav, PcmShape } from './wav';

export type { AsrFinalEvent, AsrSessionOptions } from '@theweave/api';

export interface AsrPartialEvent {
  text: string;
  tStart: number;
  tEnd: number;
}

const DEFAULT_SAMPLE_RATE = 16_000;
const DEFAULT_CHANNELS: 1 | 2 = 1;
const DEFAULT_MAX_BUFFER_MS = 30_000;
/**
 * How much audio to keep ahead of the first speech chunk when VAD is
 * on. Enough to catch a soft onset the RMS gate missed; small enough
 * that an open mic in a quiet room never accumulates or transcribes
 * long stretches of silence.
 */
const PRE_SPEECH_RETAIN_MS = 2_000;

const VAD_DEFAULTS = {
  enabled: true,
  silenceRms: 0.01,
  silenceMs: 500,
} as const;

type Listener<T> = (ev: T) => void;

/** Audio snapshot handed to one transcribe call. */
interface FlushBatch {
  chunks: Int16Array[];
  samples: number;
  /** Position of the batch's first sample on the session clock, in ms. */
  baseMs: number;
  durationMs: number;
}

export class AsrSessionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AsrSessionStateError';
  }
}

/**
 * Single ASR session over a shared WhisperServer. The session owns
 * the per-utterance buffer + listener fan-out; the server is shared
 * across sessions and managed by the broker.
 *
 * Construct via `AsrBroker.openSession(...)` — the broker passes in
 * the lifecycle hooks. Direct construction is supported for tests
 * (and for callers that manage their own WhisperServer).
 */
export class AsrSession {
  private chunks: Int16Array[] = [];
  private bufferedSamples = 0;
  /**
   * Session clock: ms of audio accounted for so far, whether it was
   * transcribed or dropped as pre-speech silence. Advanced
   * synchronously at push time so timestamps never depend on when a
   * transcribe happens to finish.
   */
  private clockMs = 0;
  private closed = false;
  private failed = false;
  /**
   * Chain of pending transcribe calls. Flushes run strictly in audio
   * order so `final` events never arrive out of sequence, while
   * pushAudio() itself only appends and returns.
   */
  private inflight: Promise<void> = Promise.resolve();

  private finalListeners = new Set<Listener<AsrFinalEvent>>();
  private partialListeners = new Set<Listener<AsrPartialEvent>>();
  private errorListeners = new Set<Listener<Error>>();

  private readonly shape: PcmShape;
  private readonly language: string | undefined;
  private readonly maxBufferSamples: number;
  private readonly preSpeechRetainSamples: number;

  // VAD state. `hasSpoken` flips true on the first chunk above the
  // RMS threshold and resets when a flush commits. `silentSamples`
  // counts continuous silent samples since the last speech chunk.
  private readonly vadEnabled: boolean;
  private readonly vadSilenceRms: number;
  private readonly vadSilenceSamples: number;
  private vadHasSpoken = false;
  private vadSilentSamples = 0;

  // MOSS_ASR_DEBUG trace of what the VAD sees, summarized once per
  // second of pushed audio so a silent-looking session can be told
  // apart from one whose speech never crosses the RMS gate.
  private debugMaxRms = 0;
  private debugSamplesSinceTrace = 0;
  private debugChunksSinceTrace = 0;
  // MOSS_ASR_DUMP_DIR: every committed WAV is written there, named by
  // session and commit index, so what whisper heard can be replayed.
  private readonly dumpTag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  private dumpIndex = 0;

  constructor(
    private readonly server: WhisperServer,
    private readonly onClose: () => void | Promise<void>,
    opts: AsrSessionOptions = {},
  ) {
    this.shape = {
      sampleRate: opts.sampleRate ?? DEFAULT_SAMPLE_RATE,
      channels: opts.channels ?? DEFAULT_CHANNELS,
    };
    this.language = opts.language;
    this.maxBufferSamples = this.msToSamples(opts.maxBufferMs ?? DEFAULT_MAX_BUFFER_MS);
    this.preSpeechRetainSamples = this.msToSamples(PRE_SPEECH_RETAIN_MS);

    this.vadEnabled = opts.vad ?? VAD_DEFAULTS.enabled;
    this.vadSilenceRms = opts.vadSilenceRms ?? VAD_DEFAULTS.silenceRms;
    this.vadSilenceSamples = this.msToSamples(opts.vadSilenceMs ?? VAD_DEFAULTS.silenceMs);
  }

  /** Diagnostic only. Reflects whether close() has been called. */
  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Push a PCM16 chunk. Appends to the current utterance and returns
   * immediately; a transcribe is queued (never awaited here) when any
   * of these fire:
   *   - `endOfUtterance` is true
   *   - VAD detects silence-after-speech ≥ `vadSilenceMs`
   *   - the accumulated buffer reaches `maxBufferMs`
   *
   * Transcribe failures are reported through onError, after which the
   * session is closed.
   */
  async pushAudio(pcm: Int16Array, endOfUtterance: boolean = false): Promise<void> {
    if (this.closed) {
      throw new AsrSessionStateError('pushAudio() called on a closed session');
    }
    if (pcm.length === 0 && !endOfUtterance) return;

    let vadFired = false;
    if (pcm.length > 0) {
      this.chunks.push(pcm);
      this.bufferedSamples += pcm.length;
      if (this.vadEnabled) {
        vadFired = this.updateVad(pcm);
      }
      if (process.env.MOSS_ASR_DEBUG) this.traceVad(pcm);
    }
    if (this.vadEnabled && !this.vadHasSpoken && !endOfUtterance) {
      this.trimPreSpeech();
    }
    const overCap = this.bufferedSamples >= this.maxBufferSamples;
    if (endOfUtterance || vadFired || overCap) {
      this.scheduleFlush();
    }
  }

  /**
   * Resolves once every transcribe queued so far has completed (or
   * failed). Finals for those flushes have been emitted by then.
   */
  settle(): Promise<void> {
    return this.inflight;
  }

  onFinal(cb: Listener<AsrFinalEvent>): () => void {
    this.finalListeners.add(cb);
    return () => this.finalListeners.delete(cb);
  }

  onPartial(cb: Listener<AsrPartialEvent>): () => void {
    this.partialListeners.add(cb);
    return () => this.partialListeners.delete(cb);
  }

  onError(cb: Listener<Error>): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  /**
   * Close the session. Flushes any pending audio, then releases the
   * shared server back to the broker. Idempotent.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.bufferedSamples > 0 && !this.failed) {
        this.scheduleFlush();
      }
      await this.inflight;
    } finally {
      await this.onClose();
    }
  }

  private msToSamples(ms: number): number {
    return Math.round((ms / 1000) * this.shape.sampleRate * this.shape.channels);
  }

  private samplesToMs(samples: number): number {
    return Math.round((samples / this.shape.channels / this.shape.sampleRate) * 1000);
  }

  /**
   * Energy-VAD update for the just-buffered chunk. Returns true if
   * this chunk completed a speech-then-silence pattern long enough to
   * commit. Resets internal state on commit so the next utterance
   * starts fresh.
   */
  private updateVad(pcm: Int16Array): boolean {
    const rms = computeRms(pcm);
    const isSilent = rms < this.vadSilenceRms;

    if (!isSilent) {
      this.vadHasSpoken = true;
      this.vadSilentSamples = 0;
      return false;
    }
    if (!this.vadHasSpoken) {
      // Pre-speech silence — keep waiting.
      return false;
    }
    this.vadSilentSamples += pcm.length;
    if (this.vadSilentSamples >= this.vadSilenceSamples) {
      this.resetVad();
      return true;
    }
    return false;
  }

  private traceVad(pcm: Int16Array): void {
    this.debugMaxRms = Math.max(this.debugMaxRms, computeRms(pcm));
    this.debugSamplesSinceTrace += pcm.length;
    this.debugChunksSinceTrace += 1;
    if (this.debugSamplesSinceTrace < this.msToSamples(1_000)) return;
    process.stderr.write(
      `[asr-debug] vad: chunks=${this.debugChunksSinceTrace} maxRms=${this.debugMaxRms.toFixed(4)} gate=${this.vadSilenceRms} hasSpoken=${this.vadHasSpoken} buffered=${this.samplesToMs(this.bufferedSamples)}ms clock=${this.clockMs}ms\n`,
    );
    this.debugMaxRms = 0;
    this.debugSamplesSinceTrace = 0;
    this.debugChunksSinceTrace = 0;
  }

  private resetVad(): void {
    this.vadHasSpoken = false;
    this.vadSilentSamples = 0;
  }

  /**
   * Drop the oldest pre-speech chunks beyond the retention window.
   * Dropped audio still advances the session clock so later finals
   * keep their offsets from session start.
   */
  private trimPreSpeech(): void {
    while (
      this.chunks.length > 1 &&
      this.bufferedSamples - this.chunks[0].length >= this.preSpeechRetainSamples
    ) {
      const dropped = this.chunks.shift()!;
      this.bufferedSamples -= dropped.length;
      this.clockMs += this.samplesToMs(dropped.length);
    }
  }

  /** Snapshot the buffer as a batch and queue it behind earlier flushes. */
  private scheduleFlush(): void {
    this.resetVad();
    if (this.bufferedSamples === 0) return;
    const batch: FlushBatch = {
      chunks: this.chunks,
      samples: this.bufferedSamples,
      baseMs: this.clockMs,
      durationMs: this.samplesToMs(this.bufferedSamples),
    };
    this.chunks = [];
    this.bufferedSamples = 0;
    this.clockMs += batch.durationMs;
    this.inflight = this.inflight.then(() => this.flushBatch(batch)).catch(() => undefined);
  }

  private async flushBatch(batch: FlushBatch): Promise<void> {
    if (this.failed) return;
    if (this.server.state !== ('ready' satisfies WhisperServerState)) {
      this.fail(
        new AsrSessionStateError(`cannot transcribe: underlying server is ${this.server.state}`),
      );
      return;
    }

    const merged = mergeInt16(batch.chunks, batch.samples);
    const wav = pcm16ToWav(merged, this.shape);
    const dumpBase = this.dumpWav(wav, batch);
    let result: AsrTranscribeResult;
    try {
      result = await this.server.transcribe(wav, { language: this.language });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.dumpResult(dumpBase, { error: error.message });
      this.fail(error);
      return;
    }
    this.dumpResult(dumpBase, {
      text: result.segments.map((seg) => seg.text).join(' '),
      segments: result.segments,
      lang: result.lang,
      inferMs: result.inferMs,
    });

    if (process.env.MOSS_ASR_DEBUG) {
      const texts = result.segments.map((s) => s.text).join(' | ');
      process.stderr.write(
        `[asr-debug] flush: ${batch.samples} samples @ ${this.shape.sampleRate}Hz×${this.shape.channels}ch (${batch.durationMs}ms) → segments=${result.segments.length} lang=${result.lang ?? '?'} inferMs=${result.inferMs}${texts ? ` text=${JSON.stringify(texts)}` : ''}\n`,
      );
    }

    for (const seg of result.segments) {
      this.emitFinal(toFinal(seg, batch.baseMs, result.lang));
    }
  }

  /** Returns the dump path without extension, or null when dumping is off. */
  private dumpWav(wav: Buffer, batch: FlushBatch): string | null {
    const dir = process.env.MOSS_ASR_DUMP_DIR;
    if (!dir) return null;
    try {
      mkdirSync(dir, { recursive: true });
      const base = path.join(
        dir,
        `asr-${this.dumpTag}-${String(this.dumpIndex++).padStart(3, '0')}-at${batch.baseMs}ms-${batch.durationMs}ms`,
      );
      writeFileSync(`${base}.wav`, wav);
      return base;
    } catch (err) {
      process.stderr.write(`[asr-debug] wav dump failed: ${String(err)}\n`);
      return null;
    }
  }

  private dumpResult(base: string | null, result: Record<string, unknown>): void {
    if (!base) return;
    try {
      writeFileSync(`${base}.json`, JSON.stringify(result, null, 2));
    } catch (err) {
      process.stderr.write(`[asr-debug] result dump failed: ${String(err)}\n`);
    }
  }

  /**
   * Terminal failure: report once, drop whatever is buffered, and
   * release the broker reference. A caller's own close() afterwards is
   * a no-op, so the server is released exactly once.
   */
  private fail(err: Error): void {
    if (this.failed) return;
    this.failed = true;
    this.chunks = [];
    this.bufferedSamples = 0;
    this.emitError(err);
    if (!this.closed) {
      this.closed = true;
      void Promise.resolve()
        .then(() => this.onClose())
        .catch(() => undefined);
    }
  }

  private emitFinal(ev: AsrFinalEvent): void {
    for (const cb of this.finalListeners) {
      try {
        cb(ev);
      } catch {
        // Listeners are caller-controlled; their failures must not
        // tank the session. Swallow and continue.
      }
    }
  }

  private emitError(err: Error): void {
    for (const cb of this.errorListeners) {
      try {
        cb(err);
      } catch {
        // ditto
      }
    }
  }
}

function mergeInt16(parts: Int16Array[], totalSamples: number): Int16Array {
  if (parts.length === 1) return parts[0];
  const out = new Int16Array(totalSamples);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function toFinal(seg: AsrSegment, baseMs: number, lang: string | undefined): AsrFinalEvent {
  return {
    text: seg.text,
    tStart: baseMs + seg.tStart,
    tEnd: baseMs + seg.tEnd,
    confidence: seg.confidence,
    lang,
  };
}

/** RMS in normalized [-1, 1] of an Int16Array audio buffer. */
function computeRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] / 32768;
    sumSquares += v * v;
  }
  return Math.sqrt(sumSquares / pcm.length);
}

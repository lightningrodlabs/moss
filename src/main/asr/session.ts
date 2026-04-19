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

import { AsrSegment, AsrTranscribeResult, WhisperServerState } from './types';
import { WhisperServer } from './whisperServer';
import { pcm16ToWav, PcmShape } from './wav';

export interface AsrFinalEvent {
  text: string;
  /** ms from session start */
  tStart: number;
  tEnd: number;
  confidence?: number;
  lang?: string;
}

export interface AsrPartialEvent {
  text: string;
  tStart: number;
  tEnd: number;
}

export interface AsrSessionOptions {
  /** ISO 639-1 code. Auto-detect if omitted (whisper-server default). */
  language?: string;
  /** Sample rate of pushed PCM. Defaults to 16000. */
  sampleRate?: number;
  /** Channels of pushed PCM. Defaults to 1. */
  channels?: 1 | 2;
  /**
   * Maximum buffered audio (ms) before we force a flush, even without
   * `endOfUtterance` and even if VAD never fires (e.g. continuous
   * speech with no pauses). Belt-and-suspenders against runaway
   * buffers. Default 30_000.
   */
  maxBufferMs?: number;
  /**
   * Enable Moss-side VAD. When true (default) the session commits an
   * utterance whenever it sees `vadSilenceMs` of continuous silence
   * after at least one speech chunk. When false, only `endOfUtterance`
   * and `maxBufferMs` trigger commits — caller is fully in control.
   */
  vad?: boolean;
  /**
   * Silence threshold as RMS in normalized [-1, 1]. Audio chunks with
   * RMS below this are treated as silence. Default 0.01 — typical room
   * noise sits 0.001–0.005, normal speech sits 0.05–0.3 (post-AGC).
   * Bump higher in noisy environments; lower for quiet voices.
   */
  vadSilenceRms?: number;
  /**
   * How much continuous post-speech silence (ms) triggers a commit.
   * Default 500 — roughly the inter-sentence pause in conversational
   * English. Shorter feels jumpy; longer feels laggy.
   */
  vadSilenceMs?: number;
}

const DEFAULT_SAMPLE_RATE = 16_000;
const DEFAULT_CHANNELS: 1 | 2 = 1;
const DEFAULT_MAX_BUFFER_MS = 30_000;

const VAD_DEFAULTS = {
  enabled: true,
  silenceRms: 0.01,
  silenceMs: 500,
} as const;

type Listener<T> = (ev: T) => void;

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
  private cursorMs = 0;
  private closed = false;
  /**
   * Serializes pushAudio() calls. Without this, two near-simultaneous
   * push-with-flush calls would both build their own WAV from a
   * shared buffer view in indeterminate order. Trade off some
   * concurrency for predictable ordering of finals.
   */
  private inflight: Promise<void> = Promise.resolve();

  private finalListeners = new Set<Listener<AsrFinalEvent>>();
  private partialListeners = new Set<Listener<AsrPartialEvent>>();
  private errorListeners = new Set<Listener<Error>>();

  private readonly shape: PcmShape;
  private readonly maxBufferSamples: number;

  // VAD state. `hasSpoken` flips true on the first chunk above the
  // RMS threshold and resets when a flush commits. `silentSamples`
  // counts continuous silent samples since the last speech chunk.
  private readonly vadEnabled: boolean;
  private readonly vadSilenceRms: number;
  private readonly vadSilenceSamples: number;
  private vadHasSpoken = false;
  private vadSilentSamples = 0;
  // opts.language is accepted in the public surface but not yet
  // forwarded to whisper-server (the multipart body in WhisperServer.
  // transcribe() doesn't include it). Wire it through when M2 needs
  // language hints from real callers.

  constructor(
    private readonly server: WhisperServer,
    private readonly onClose: () => void | Promise<void>,
    opts: AsrSessionOptions = {},
  ) {
    this.shape = {
      sampleRate: opts.sampleRate ?? DEFAULT_SAMPLE_RATE,
      channels: opts.channels ?? DEFAULT_CHANNELS,
    };
    this.maxBufferSamples =
      ((opts.maxBufferMs ?? DEFAULT_MAX_BUFFER_MS) / 1000) *
      this.shape.sampleRate *
      this.shape.channels;

    this.vadEnabled = opts.vad ?? VAD_DEFAULTS.enabled;
    this.vadSilenceRms = opts.vadSilenceRms ?? VAD_DEFAULTS.silenceRms;
    const vadSilenceMs = opts.vadSilenceMs ?? VAD_DEFAULTS.silenceMs;
    this.vadSilenceSamples = Math.round(
      (vadSilenceMs / 1000) * this.shape.sampleRate * this.shape.channels,
    );
  }

  /** Diagnostic only. Reflects whether close() has been called. */
  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Push a PCM16 chunk. Triggers a flush (transcribe → emit finals)
   * when any of:
   *   - `endOfUtterance` is true
   *   - VAD detects silence-after-speech ≥ `vadSilenceMs`
   *   - the accumulated buffer reaches `maxBufferMs`
   *
   * Pushes are serialized: a flush in progress will block subsequent
   * pushes until done. This keeps `final` events ordered by audio
   * time, which is what callers like Presence assume.
   */
  async pushAudio(pcm: Int16Array, endOfUtterance: boolean = false): Promise<void> {
    if (this.closed) {
      throw new AsrSessionStateError('pushAudio() called on a closed session');
    }
    if (pcm.length === 0 && !endOfUtterance) return;

    const next = this.inflight.then(async () => {
      let vadFired = false;
      if (pcm.length > 0) {
        this.chunks.push(pcm);
        this.bufferedSamples += pcm.length;
        if (this.vadEnabled) {
          vadFired = this.updateVad(pcm);
        }
      }
      const overCap = this.bufferedSamples >= this.maxBufferSamples;
      if (endOfUtterance || vadFired || overCap) {
        await this.flush();
      }
    });
    this.inflight = next.catch(() => {});
    return next;
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
      await this.inflight;
      if (this.bufferedSamples > 0) {
        await this.flush();
      }
    } finally {
      await this.onClose();
    }
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

  private resetVad(): void {
    this.vadHasSpoken = false;
    this.vadSilentSamples = 0;
  }

  private async flush(): Promise<void> {
    if (this.bufferedSamples === 0) {
      this.resetVad();
      return;
    }
    if (this.server.state !== ('ready' satisfies WhisperServerState)) {
      throw new AsrSessionStateError(
        `cannot flush: underlying server is ${this.server.state}`,
      );
    }

    const merged = mergeInt16(this.chunks, this.bufferedSamples);
    const flushedSamples = this.bufferedSamples;
    this.chunks = [];
    this.bufferedSamples = 0;
    this.resetVad();

    const wav = pcm16ToWav(merged, this.shape);
    let result: AsrTranscribeResult;
    try {
      result = await this.server.transcribe(wav);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.emitError(e);
      throw e;
    }

    const flushedFrames = flushedSamples / this.shape.channels;
    const flushedMs = Math.round((flushedFrames / this.shape.sampleRate) * 1000);
    const baseMs = this.cursorMs;

    for (const seg of result.segments) {
      this.emitFinal(toFinal(seg, baseMs, result.lang));
    }
    this.cursorMs += flushedMs;
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

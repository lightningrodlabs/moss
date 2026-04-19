// AsrSession — caller pushes PCM16 chunks, listens for final-segment
// events. Sits on top of a WhisperServer obtained from the broker.
//
// V1 chunking strategy is deliberately simple: the caller signals
// utterance boundaries via `endOfUtterance: true` (their VAD), and we
// also force-flush when the buffer exceeds a safety cap. No partial
// events in v1 — the M0 spike showed they cost a full encoder pass per
// chunk and quality is poor. M2/M3 can add a partials path with proper
// VAD chunking when there's a consumer that needs them.

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
   * `endOfUtterance`. Prevents a malformed caller (one that never sets
   * the flag) from buffering forever. Default 30_000.
   */
  maxBufferMs?: number;
}

const DEFAULT_SAMPLE_RATE = 16_000;
const DEFAULT_CHANNELS: 1 | 2 = 1;
const DEFAULT_MAX_BUFFER_MS = 30_000;

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
  }

  /** Diagnostic only. Reflects whether close() has been called. */
  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Push a PCM16 chunk. If `endOfUtterance` is true, or the buffer
   * exceeds the configured cap, transcribe what's accumulated and
   * emit final events. Returns when the push (and any triggered
   * flush) is done.
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
      if (pcm.length > 0) {
        this.chunks.push(pcm);
        this.bufferedSamples += pcm.length;
      }
      const overCap = this.bufferedSamples >= this.maxBufferSamples;
      if (endOfUtterance || overCap) {
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

  private async flush(): Promise<void> {
    if (this.bufferedSamples === 0) return;
    if (this.server.state !== ('ready' satisfies WhisperServerState)) {
      throw new AsrSessionStateError(
        `cannot flush: underlying server is ${this.server.state}`,
      );
    }

    const merged = mergeInt16(this.chunks, this.bufferedSamples);
    const flushedSamples = this.bufferedSamples;
    this.chunks = [];
    this.bufferedSamples = 0;

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

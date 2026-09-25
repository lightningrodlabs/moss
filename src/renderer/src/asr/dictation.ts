// One dictation session for Moss's own UI: capture the microphone, stream
// it to a Moss-side ASR session, and report each final transcript segment.
// Everything that touches Electron or the browser sits behind
// `DictationHost`, so the start and stop logic runs in plain node tests.

import type { AsrIncomingEvent, AsrSessionOptions } from '@theweave/api';

import { floatToPcm16Bytes } from './pcm.js';

/** A running microphone capture. */
export interface MicCapture {
  /** The native sample rate of the captured audio. */
  sampleRate: number;
  /** The next block of mono float samples, or null once capture has stopped. */
  read(): Promise<Float32Array | null>;
  /** Stop capture and release the device. Idempotent. */
  stop(): void;
}

export interface DictationHost {
  warmUp(): Promise<void>;
  openMic(): Promise<MicCapture>;
  openSession(opts: AsrSessionOptions): Promise<{ sessionId: string }>;
  pushAudio(req: { sessionId: string; pcm: Uint8Array }): Promise<void>;
  closeSession(req: { sessionId: string }): Promise<void>;
  /** Route the session's events to `listener` until `unregister`. */
  registerListener(sessionId: string, listener: (event: AsrIncomingEvent) => void): void;
  unregister(sessionId: string): void;
}

export type DictationState = 'idle' | 'starting' | 'listening' | 'stopping';

export interface DictationCallbacks {
  onText(text: string): void;
  onError(message: string): void;
  onStateChange(state: DictationState): void;
}

interface ActiveSession {
  sessionId: string;
  mic: MicCapture;
  pump: Promise<void>;
}

/** The bundled model is English only. */
const DICTATION_LANGUAGE = 'en';

export class Dictation {
  state: DictationState = 'idle';
  private active: ActiveSession | null = null;
  // Bumped by every stop or abort, so a start that is still awaiting the
  // microphone or the session can tell that it was cancelled.
  private generation = 0;

  constructor(
    private readonly host: DictationHost,
    private readonly callbacks: DictationCallbacks,
  ) {}

  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    const gen = ++this.generation;
    this.setState('starting');
    // Loading the model can take a while; the shell shows its own notice
    // for that, and a failed warm-up surfaces again at openSession.
    this.host.warmUp().catch(() => undefined);

    let mic: MicCapture | undefined;
    let sessionId: string;
    try {
      mic = await this.host.openMic();
      if (gen !== this.generation) {
        mic.stop();
        return;
      }
      ({ sessionId } = await this.host.openSession({
        language: DICTATION_LANGUAGE,
        sampleRate: mic.sampleRate,
        channels: 1,
      }));
    } catch (e) {
      mic?.stop();
      if (gen === this.generation) {
        this.setState('idle');
        this.callbacks.onError(errorMessage(e));
      }
      return;
    }
    if (gen !== this.generation) {
      mic.stop();
      await this.host.closeSession({ sessionId }).catch(() => undefined);
      return;
    }

    this.host.registerListener(sessionId, (event) => this.onEvent(sessionId, event));
    this.active = { sessionId, mic, pump: this.pump(sessionId, mic) };
    this.setState('listening');
  }

  /** Stop capture and close the session; finals still in flight are delivered first. */
  async stop(): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopping') return;
    this.generation++;
    const active = this.active;
    if (!active) {
      this.setState('idle');
      return;
    }
    this.setState('stopping');
    active.mic.stop();
    await active.pump;
    // Closing flushes buffered audio; its finals arrive before close resolves.
    await this.host.closeSession({ sessionId: active.sessionId }).catch(() => undefined);
    this.host.unregister(active.sessionId);
    this.active = null;
    this.setState('idle');
  }

  private async pump(sessionId: string, mic: MicCapture): Promise<void> {
    try {
      for (;;) {
        const block = await mic.read();
        if (!block || this.active?.sessionId !== sessionId) return;
        await this.host.pushAudio({ sessionId, pcm: floatToPcm16Bytes(block) });
      }
    } catch (e) {
      if (this.active?.sessionId === sessionId && this.state === 'listening') {
        this.abort(errorMessage(e));
      }
    }
  }

  private onEvent(sessionId: string, event: AsrIncomingEvent): void {
    if (event.eventType === 'final') {
      const text = event.text.trim();
      if (text) this.callbacks.onText(text);
      return;
    }
    if (this.active?.sessionId === sessionId) this.abort(event.error);
  }

  /** The session is gone on the main side; release everything local. */
  private abort(message: string): void {
    const active = this.active;
    if (!active) return;
    this.generation++;
    this.active = null;
    active.mic.stop();
    this.host.unregister(active.sessionId);
    this.setState('idle');
    this.callbacks.onError(message);
  }

  private setState(state: DictationState): void {
    this.state = state;
    this.callbacks.onStateChange(state);
  }
}

/** Append a transcript segment to existing input text, separated by one space. */
export function appendTranscript(current: string, text: string): string {
  const base = current.trimEnd();
  return base ? `${base} ${text}` : text;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

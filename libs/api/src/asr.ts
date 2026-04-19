// Public ASR (speech-to-text) surface exposed to applets via
// WeaveClient.localModels.asr.
//
// The applet calls `weaveClient.localModels?.asr.openSession(...)` and
// gets back an `AsrSession` it can push PCM audio to and receive
// transcripts from. Behind the scenes the session round-trips its
// requests through:
//
//   applet code
//     ↓ WeaveClient.localModels.asr (this file)
//     ↓ window.__WEAVE_API__.localModels.asr (set up in applet-iframe)
//     ↓ postMessage to parent (renderer)
//     ↓ window.electronAPI.asr* (preload)
//     ↓ ipcMain handler in src/main/asr/ipcHandlers.ts
//     ↓ AsrBroker → AsrSession → WhisperServer
//
// Events flow back along the reverse path. The factory in this file
// is what the applet-iframe wires up; it relies on a small transport
// interface that abstracts away postMessage so the AsrSession class
// stays unit-testable without a real iframe environment.

import type {
  AsrFinalEvent,
  AsrSessionOptions,
  LocalAsrCapabilities,
  LocalModelCapabilities,
} from './types.js';

// Re-export the wire-protocol types so consumers can import everything
// from a single namespace.
export type {
  AsrFinalEvent,
  AsrSessionOptions,
  LocalAsrCapabilities,
  LocalModelCapabilities,
} from './types.js';

export interface AsrPartialEvent {
  text: string;
  tStart: number;
  tEnd: number;
}

export interface AsrSession {
  /**
   * Push a PCM16 chunk. Pass `endOfUtterance: true` if you have your
   * own VAD and know an utterance just ended; otherwise let Moss
   * decide when to commit (it force-flushes after a buffered window).
   */
  pushAudio(pcm16: Int16Array, endOfUtterance?: boolean): Promise<void>;

  /**
   * Subscribe to committed transcripts. Returns an unsubscribe
   * function. Multiple subscribers are fine; each gets every event.
   */
  onFinal(callback: (event: AsrFinalEvent) => void): UnsubscribeFn;

  /**
   * Subscribe to in-progress transcripts. **Not emitted in v1** —
   * whisper.cpp's batch shape and the cost of per-window encoder
   * passes mean Moss currently only emits finals. Returning a no-op
   * unsubscribe lets caller code be written for the future without
   * breaking when partials are eventually wired.
   */
  onPartial(callback: (event: AsrPartialEvent) => void): UnsubscribeFn;

  /**
   * Subscribe to session-level errors (model load failure, sidecar
   * crash, malformed audio, etc). The session is closed by Moss after
   * an error fires; callers should treat the error as terminal.
   */
  onError(callback: (error: Error) => void): UnsubscribeFn;

  /**
   * Close the session. Flushes any pending audio, releases the broker
   * reference (which may then idle-unload the model). Idempotent.
   */
  close(): Promise<void>;

  /** Stable id for diagnostics. Set after openSession() returns. */
  readonly sessionId: string;
}

export type UnsubscribeFn = () => void;

export interface AsrApi {
  openSession(opts?: AsrSessionOptions): Promise<AsrSession>;
}

export interface LocalModelsApi {
  /**
   * Introspect what's wired up on the host. Tools should call this
   * before offering model-dependent UI; `capabilities().asr.available`
   * will be false if the host is present but has no model configured.
   */
  capabilities(): Promise<LocalModelCapabilities>;
  /** Speech-to-text. May throw if the host has no model configured. */
  asr: AsrApi;
}

/**
 * Transport seam for AsrSession. The applet-iframe wires this with
 * real postMessage + parent-event-dispatch; tests pass a fake.
 */
export interface AsrTransport {
  /** Send a request to the parent (renderer). Resolves with the parent's reply. */
  send: (request: AsrSessionRequest) => Promise<unknown>;
  /**
   * Subscribe to events from the parent. The transport invokes the
   * callback for every 'asr-event' that arrives, regardless of
   * sessionId — the AsrSession filters by its own id. Returns
   * unsubscribe.
   */
  subscribe: (callback: (event: AsrIncomingEvent) => void) => UnsubscribeFn;
}

export type AsrSessionRequest =
  | { type: 'asr-capabilities' }
  | { type: 'asr-open-session'; opts?: AsrSessionOptions }
  | {
      type: 'asr-push-audio';
      sessionId: string;
      pcm: Uint8Array;
      endOfUtterance?: boolean;
    }
  | { type: 'asr-close-session'; sessionId: string };

export type AsrIncomingEvent =
  | (AsrFinalEvent & { sessionId: string; eventType: 'final' })
  | { sessionId: string; eventType: 'error'; error: string };

/**
 * Factory: open a session via the supplied transport and return a
 * fully-wired AsrSession. Used by applet-iframe to back
 * `weaveClient.localModels.asr.openSession()`.
 */
export async function openAsrSession(
  transport: AsrTransport,
  opts?: AsrSessionOptions,
): Promise<AsrSession> {
  const reply = await transport.send({ type: 'asr-open-session', opts });
  const sessionId = extractSessionId(reply);
  return new AppletAsrSession(transport, sessionId);
}

/**
 * Introspection fetch: asks the host what ASR capabilities are wired
 * up. Used by applet-iframe to back
 * `weaveClient.localModels.capabilities()`.
 */
export async function fetchAsrCapabilities(
  transport: AsrTransport,
): Promise<LocalModelCapabilities> {
  const reply = await transport.send({ type: 'asr-capabilities' });
  return extractCapabilities(reply);
}

function extractCapabilities(reply: unknown): LocalModelCapabilities {
  if (!isObject(reply) || !isObject(reply.asr)) {
    throw new Error(`Bad asr-capabilities reply: ${JSON.stringify(reply)}`);
  }
  const asr = reply.asr as Record<string, unknown>;
  if (
    typeof asr.available !== 'boolean' ||
    !Array.isArray(asr.languages) ||
    !asr.languages.every((l): l is string => typeof l === 'string') ||
    typeof asr.streaming !== 'boolean' ||
    typeof asr.model !== 'string' ||
    (asr.latencyTier !== 'fast' && asr.latencyTier !== 'ok' && asr.latencyTier !== 'slow')
  ) {
    throw new Error(`Bad asr-capabilities reply: ${JSON.stringify(reply)}`);
  }
  const capabilities: LocalAsrCapabilities = {
    available: asr.available,
    languages: asr.languages,
    streaming: asr.streaming,
    model: asr.model,
    latencyTier: asr.latencyTier,
  };
  return { asr: capabilities };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function extractSessionId(reply: unknown): string {
  if (
    reply &&
    typeof reply === 'object' &&
    'sessionId' in reply &&
    typeof (reply as { sessionId: unknown }).sessionId === 'string'
  ) {
    return (reply as { sessionId: string }).sessionId;
  }
  throw new Error(`Bad asr-open-session reply: ${JSON.stringify(reply)}`);
}

class AppletAsrSession implements AsrSession {
  private readonly finalSubs = new Set<(ev: AsrFinalEvent) => void>();
  private readonly errorSubs = new Set<(err: Error) => void>();
  private readonly unsubscribeTransport: UnsubscribeFn;
  private closed = false;

  constructor(
    private readonly transport: AsrTransport,
    public readonly sessionId: string,
  ) {
    this.unsubscribeTransport = transport.subscribe((ev) => this.onIncoming(ev));
  }

  async pushAudio(pcm16: Int16Array, endOfUtterance: boolean = false): Promise<void> {
    if (this.closed) {
      throw new Error('AsrSession is closed');
    }
    // Send the underlying bytes; recipient reinterprets as Int16Array.
    const pcm = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
    await this.transport.send({
      type: 'asr-push-audio',
      sessionId: this.sessionId,
      pcm,
      endOfUtterance,
    });
  }

  onFinal(callback: (ev: AsrFinalEvent) => void): UnsubscribeFn {
    this.finalSubs.add(callback);
    return () => this.finalSubs.delete(callback);
  }

  // No-op in v1; see comment on the interface declaration above.
  onPartial(_callback: (ev: AsrPartialEvent) => void): UnsubscribeFn {
    return () => undefined;
  }

  onError(callback: (err: Error) => void): UnsubscribeFn {
    this.errorSubs.add(callback);
    return () => this.errorSubs.delete(callback);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribeTransport();
    try {
      await this.transport.send({ type: 'asr-close-session', sessionId: this.sessionId });
    } catch {
      // close errors are not actionable for the caller
    }
  }

  private onIncoming(ev: AsrIncomingEvent): void {
    if (ev.sessionId !== this.sessionId) return;
    if (ev.eventType === 'final') {
      const final: AsrFinalEvent = {
        text: ev.text,
        tStart: ev.tStart,
        tEnd: ev.tEnd,
        confidence: ev.confidence,
        lang: ev.lang,
      };
      for (const cb of this.finalSubs) {
        try {
          cb(final);
        } catch {
          // listener errors must not break delivery to other listeners
        }
      }
    } else if (ev.eventType === 'error') {
      const err = new Error(ev.error);
      for (const cb of this.errorSubs) {
        try {
          cb(err);
        } catch {
          // ditto
        }
      }
    }
  }
}

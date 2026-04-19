// Renderer-side ASR bridge.
//
// The IPC layer in src/main pushes 'asr-event' messages to whichever
// renderer (BrowserWindow webContents) opened the session. Within
// THIS renderer we then have to route that event to the right applet
// iframe — multiple applets and multiple sessions can be alive at
// once, and only one of them should hear about each event.
//
// The bridge maintains `sessionId → MessageEventSource` so that when
// we hear an 'asr-event' from main we can postMessage it to the iframe
// that opened the session. Registration happens in applet-host.ts when
// it handles 'asr-open-session'; unregistration happens on
// 'asr-close-session' or implicitly on iframe destruction.
//
// Subscribed to window.electronAPI.onAsrEvent once at app start via
// initAsrRendererBridge().

import type { ParentToAppletMessage } from '@theweave/api';

type AsrIpcEvent = Extract<ParentToAppletMessage, { type: 'asr-event' }>['event'];

export class AsrRendererBridge {
  private sources = new Map<string, MessageEventSource>();

  registerSession(sessionId: string, source: MessageEventSource | null | 'wal-window'): void {
    if (!source || source === 'wal-window') {
      // The applet iframe wasn't reachable as a MessageEventSource —
      // most commonly the case for iframes hosted in WAL windows or
      // for sources we cannot route back to. Skip registration; the
      // applet won't receive events but the session itself still works
      // for synchronous calls.
      return;
    }
    this.sources.set(sessionId, source);
  }

  unregisterSession(sessionId: string): void {
    this.sources.delete(sessionId);
  }

  /** Broadcast an event from main to the iframe that owns the session. */
  forwardEvent(event: AsrIpcEvent): void {
    const source = this.sources.get(event.sessionId);
    if (!source) return; // session closed already, or never had a routeable source
    const message: ParentToAppletMessage = { type: 'asr-event', event };
    source.postMessage(message, { targetOrigin: '*' });
  }

  /** Diagnostic. */
  get size(): number {
    return this.sources.size;
  }
}

let bridge: AsrRendererBridge | null = null;

export function getAsrRendererBridge(): AsrRendererBridge {
  if (!bridge) bridge = new AsrRendererBridge();
  return bridge;
}

let listenerInstalled = false;

/**
 * Wire window.electronAPI.onAsrEvent into the bridge. Call once
 * at renderer startup. Idempotent.
 */
export function initAsrRendererBridge(): AsrRendererBridge {
  const b = getAsrRendererBridge();
  if (listenerInstalled) return b;
  listenerInstalled = true;
  window.electronAPI.onAsrEvent((_e, ev) => {
    b.forwardEvent(ev);
  });
  return b;
}

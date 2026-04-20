// Renderer-side ASR bridge.
//
// The IPC layer in src/main pushes 'asr-event' messages to the main
// renderer (whichever webContents opened the session — always the main
// renderer, since WAL-window applet messages are relayed through main).
// We then need to route each event to every iframe that might be
// hosting the session's applet — which includes the main-window iframes
// AND any open WAL windows for that applet.
//
// `mossStore.emitParentToAppletMessage` already does the main-iframe +
// WAL-window fan-out for us, so we just track sessionId → appletId and
// delegate. The applet iframe filters events by sessionId so only the
// window that actually opened the session reacts.
//
// Cross-group views aren't supported here — applet-host only registers
// sessions whose source is an applet (see the asr-open-session case).

import type { AppletId, ParentToAppletMessage } from '@theweave/api';

import type { MossStore } from '../moss-store.js';

type AsrIpcEvent = Extract<ParentToAppletMessage, { type: 'asr-event' }>['event'];

export class AsrRendererBridge {
  private sessionApplets = new Map<string, AppletId>();

  constructor(private readonly mossStore: MossStore) {}

  registerSession(sessionId: string, appletId: AppletId): void {
    this.sessionApplets.set(sessionId, appletId);
  }

  unregisterSession(sessionId: string): void {
    this.sessionApplets.delete(sessionId);
  }

  /** Forward an event from main to every iframe/window hosting the session's applet. */
  forwardEvent(event: AsrIpcEvent): void {
    const appletId = this.sessionApplets.get(event.sessionId);
    if (!appletId) return; // unknown or already-closed session
    void this.mossStore.emitParentToAppletMessage(
      { type: 'asr-event', event },
      [appletId],
    );
  }

  /** Diagnostic. */
  get size(): number {
    return this.sessionApplets.size;
  }
}

let bridge: AsrRendererBridge | null = null;

/**
 * Access the singleton. Call `initAsrRendererBridge(mossStore)` once at
 * app start before anything else uses the bridge.
 */
export function getAsrRendererBridge(): AsrRendererBridge {
  if (!bridge) {
    throw new Error('AsrRendererBridge not initialized; call initAsrRendererBridge() first');
  }
  return bridge;
}

let listenerInstalled = false;

/**
 * Wire window.electronAPI.onAsrEvent into the bridge. Call once at
 * renderer startup. Idempotent — second call is a no-op (but also
 * preserves the mossStore reference from the first call).
 */
export function initAsrRendererBridge(mossStore: MossStore): AsrRendererBridge {
  if (!bridge) bridge = new AsrRendererBridge(mossStore);
  if (listenerInstalled) return bridge;
  listenerInstalled = true;
  window.electronAPI.onAsrEvent((_e, ev) => {
    bridge!.forwardEvent(ev);
  });
  return bridge;
}

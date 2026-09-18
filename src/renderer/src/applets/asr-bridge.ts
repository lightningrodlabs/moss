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
// The sessionId → appletId map is also the renderer's record of session
// ownership: applet-host consults it before forwarding push/close
// requests so one applet cannot drive another applet's session, and
// the settings pane uses it to tear down sessions when the user revokes
// access.
//
// Cross-group views aren't supported here — applet-host only registers
// sessions whose source is an applet (see the asr-open-session case).

import type { AppletId, AsrIncomingEvent } from '@theweave/api';

import type { MossStore } from '../moss-store.js';

/** Error text delivered to an applet whose session was closed by the user. */
export const ASR_ACCESS_REVOKED_MESSAGE = 'Local ASR access revoked by user';

type CloseSessionFn = (sessionId: string) => Promise<void>;

const closeViaElectron: CloseSessionFn = (sessionId) =>
  window.electronAPI.asrCloseSession({ sessionId });

export class AsrRendererBridge {
  private sessionApplets = new Map<string, AppletId>();

  constructor(
    private readonly mossStore: MossStore,
    private readonly closeSession: CloseSessionFn = closeViaElectron,
  ) {}

  registerSession(sessionId: string, appletId: AppletId): void {
    this.sessionApplets.set(sessionId, appletId);
  }

  unregisterSession(sessionId: string): void {
    this.sessionApplets.delete(sessionId);
  }

  /** The applet that opened the session, or undefined if the session is unknown. */
  appletIdForSession(sessionId: string): AppletId | undefined {
    return this.sessionApplets.get(sessionId);
  }

  /** Forward an event from main to every iframe/window hosting the session's applet. */
  forwardEvent(event: AsrIncomingEvent): void {
    const appletId = this.sessionApplets.get(event.sessionId);
    if (!appletId) return; // unknown or already-closed session
    void this.mossStore.emitParentToAppletMessage({ type: 'asr-event', event }, [appletId]);
    // Main closes a session once it has errored, so the id is dead from
    // here on; dropping it keeps the ownership map from growing.
    if (event.eventType === 'error') this.sessionApplets.delete(event.sessionId);
  }

  /** Tear down every session opened by one applet, telling it why. */
  async closeSessionsForApplet(appletId: AppletId): Promise<void> {
    const sessionIds = [...this.sessionApplets.entries()]
      .filter(([, owner]) => owner === appletId)
      .map(([sessionId]) => sessionId);
    await Promise.all(sessionIds.map((sessionId) => this.revokeSession(sessionId, appletId)));
  }

  /** Tear down every open session, telling each applet why. */
  async closeAllSessions(): Promise<void> {
    const entries = [...this.sessionApplets.entries()];
    await Promise.all(
      entries.map(([sessionId, appletId]) => this.revokeSession(sessionId, appletId)),
    );
  }

  private async revokeSession(sessionId: string, appletId: AppletId): Promise<void> {
    this.sessionApplets.delete(sessionId);
    void this.mossStore.emitParentToAppletMessage(
      {
        type: 'asr-event',
        event: { sessionId, eventType: 'error', error: ASR_ACCESS_REVOKED_MESSAGE },
      },
      [appletId],
    );
    // Main may already have dropped the session (idle timeout, error);
    // the goal is that it is gone, so a rejection here is not a failure.
    try {
      await this.closeSession(sessionId);
    } catch {
      // intentionally ignored
    }
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

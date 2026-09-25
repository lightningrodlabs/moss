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
//
// Moss's own UI (for example foyer dictation) opens sessions too. Those
// are registered as local sessions with a listener instead of an applet,
// so their events stay in the renderer and no applet can drive them.

import type { AppletId, AsrIncomingEvent } from '@theweave/api';

import type { MossStore } from '../moss-store.js';

/** Error text delivered to an applet whose session was closed by the user. */
export const ASR_ACCESS_REVOKED_MESSAGE = 'Local ASR access revoked by user';
/** Error text delivered when the view that opened a session went away. */
export const ASR_VIEW_CLOSED_MESSAGE = 'Local ASR session closed with its view';

type CloseSessionFn = (sessionId: string) => Promise<void>;

const closeViaElectron: CloseSessionFn = (sessionId) =>
  window.electronAPI.asrCloseSession({ sessionId });

/**
 * Where a session was opened from. Main-window iframes are identified
 * by their iframe id; WAL windows by their webContents id. A session
 * with neither can only be closed by its applet or by revocation.
 */
export interface SessionOrigin {
  iframeId?: string;
  walWebContentsId?: number;
}

interface SessionRecord extends SessionOrigin {
  appletId: AppletId;
}

/** Receives the events of a session that Moss's own UI opened. */
export type LocalAsrListener = (event: AsrIncomingEvent) => void;

export class AsrRendererBridge {
  private sessions = new Map<string, SessionRecord>();
  private localSessions = new Map<string, LocalAsrListener>();

  constructor(
    private readonly mossStore: MossStore,
    private readonly closeSession: CloseSessionFn = closeViaElectron,
  ) {}

  registerSession(sessionId: string, appletId: AppletId, origin: SessionOrigin = {}): void {
    this.sessions.set(sessionId, { appletId, ...origin });
  }

  /** Register a session opened by Moss's own UI; its events go to `listener`. */
  registerLocalSession(sessionId: string, listener: LocalAsrListener): void {
    this.localSessions.set(sessionId, listener);
  }

  unregisterSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.localSessions.delete(sessionId);
  }

  /** The applet that opened the session, or undefined if the session is unknown. */
  appletIdForSession(sessionId: string): AppletId | undefined {
    return this.sessions.get(sessionId)?.appletId;
  }

  /** Forward an event from main to every iframe/window hosting the session's applet. */
  forwardEvent(event: AsrIncomingEvent): void {
    const local = this.localSessions.get(event.sessionId);
    if (local) {
      // Main closes a session once it has errored, so the id is dead.
      if (event.eventType === 'error') this.localSessions.delete(event.sessionId);
      local(event);
      return;
    }
    const record = this.sessions.get(event.sessionId);
    if (!record) return; // unknown or already-closed session
    void this.mossStore.emitParentToAppletMessage({ type: 'asr-event', event }, [record.appletId]);
    // Main closes a session once it has errored, so the id is dead from
    // here on; dropping it keeps the ownership map from growing.
    if (event.eventType === 'error') this.sessions.delete(event.sessionId);
  }

  /** Tear down every session opened by one applet, telling it why. */
  async closeSessionsForApplet(appletId: AppletId): Promise<void> {
    await this.closeMatching((r) => r.appletId === appletId, ASR_ACCESS_REVOKED_MESSAGE);
  }

  /** Tear down every open session, applet or local, telling each owner why. */
  async closeAllSessions(): Promise<void> {
    await Promise.all([
      this.closeMatching(() => true, ASR_ACCESS_REVOKED_MESSAGE),
      this.closeLocalSessions(ASR_ACCESS_REVOKED_MESSAGE),
    ]);
  }

  /** The iframe that opened these sessions is gone; release them. */
  async closeSessionsForIframe(iframeId: string): Promise<void> {
    await this.closeMatching((r) => r.iframeId === iframeId, ASR_VIEW_CLOSED_MESSAGE);
  }

  /** The WAL window that opened these sessions is gone; release them. */
  async closeSessionsForWalWindow(webContentsId: number): Promise<void> {
    await this.closeMatching((r) => r.walWebContentsId === webContentsId, ASR_VIEW_CLOSED_MESSAGE);
  }

  private async closeMatching(
    match: (record: SessionRecord) => boolean,
    reason: string,
  ): Promise<void> {
    const targets = [...this.sessions.entries()].filter(([, r]) => match(r));
    await Promise.all(
      targets.map(([sessionId, r]) => this.revokeSession(sessionId, r.appletId, reason)),
    );
  }

  private async closeLocalSessions(reason: string): Promise<void> {
    const targets = [...this.localSessions.entries()];
    this.localSessions.clear();
    await Promise.all(
      targets.map(async ([sessionId, listener]) => {
        listener({ sessionId, eventType: 'error', error: reason });
        await this.closeQuietly(sessionId);
      }),
    );
  }

  private async revokeSession(
    sessionId: string,
    appletId: AppletId,
    reason: string,
  ): Promise<void> {
    this.sessions.delete(sessionId);
    void this.mossStore.emitParentToAppletMessage(
      { type: 'asr-event', event: { sessionId, eventType: 'error', error: reason } },
      [appletId],
    );
    await this.closeQuietly(sessionId);
  }

  private async closeQuietly(sessionId: string): Promise<void> {
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
    return this.sessions.size + this.localSessions.size;
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
  window.electronAPI.onWalWindowClosed((_e, { webContentsId }) => {
    void bridge!.closeSessionsForWalWindow(webContentsId);
  });
  return bridge;
}

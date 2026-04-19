// Pure-logic IPC handlers for the ASR feature. These functions have no
// Electron dependency — the wire-up code in src/main/index.ts adapts
// them to ipcMain.handle() and webContents.send(). That separation
// lets us unit-test the routing / ownership / error-translation logic
// without spinning up Electron.
//
// Channel layout (kebab-case to match the rest of moss):
//   - 'asr-open-session'  (handle)  request  → { sessionId }
//   - 'asr-push-audio'    (handle)  request  → void
//   - 'asr-close-session' (handle)  request  → void
//   - 'asr-event'         (send)    main → renderer; per-session events
//
// The renderer that opened a session "owns" it; only that renderer can
// push audio or close it, and only that renderer receives events for
// it. Ownership is the webContents id (assigned by Electron, opaque to
// us). When a renderer goes away (window close, navigation), the
// wire-up calls asrCloseAllForOwner() to free its sessions.

import type { LocalModelCapabilities } from '@theweave/api';

import type { AsrBroker } from './broker';
import type { AsrFinalEvent, AsrSessionOptions } from './session';
import type { SessionRegistry } from './sessionRegistry';

/** Event fan-out target. The wire-up implements this with webContents.send. */
export type AsrEventEmitter = (ownerId: number, event: AsrIpcEvent) => void;

// `eventType` rather than `type` so this shape can be embedded in the
// ParentToAppletMessage envelope (whose own discriminator is `type`).
// The renderer-side bridge passes this through unchanged.
export type AsrIpcEvent =
  | (AsrFinalEvent & { sessionId: string; eventType: 'final' })
  | { sessionId: string; eventType: 'error'; error: string };

export interface AsrIpcHandlerContext {
  getBroker: () => AsrBroker;
  registry: SessionRegistry;
  emitEvent: AsrEventEmitter;
  /**
   * Introspection for the applet-facing `capabilities()` call. Resolved
   * once at wire-up time and passed through as a closure so this module
   * stays free of path / env concerns.
   */
  getCapabilities: () => LocalModelCapabilities;
}

export interface AsrOpenSessionRequest extends AsrSessionOptions {
  // Future: caller hint fields (model preference, etc).
}

export interface AsrPushAudioRequest {
  sessionId: string;
  /** Raw bytes of an Int16Array (PCM16). Length must be even. */
  pcm: Uint8Array;
  endOfUtterance?: boolean;
}

export interface AsrCloseSessionRequest {
  sessionId: string;
}

export class AsrIpcError extends Error {
  constructor(
    message: string,
    /** Suggested HTTP-style class for downstream logging. */
    public readonly kind: 'not_found' | 'forbidden' | 'invalid' | 'internal',
  ) {
    super(message);
    this.name = 'AsrIpcError';
  }
}

export async function asrGetCapabilities(
  ctx: AsrIpcHandlerContext,
): Promise<LocalModelCapabilities> {
  return ctx.getCapabilities();
}

export async function asrOpenSession(
  ctx: AsrIpcHandlerContext,
  ownerId: number,
  req: AsrOpenSessionRequest = {},
): Promise<{ sessionId: string }> {
  const session = await ctx.getBroker().openSession(req);
  const sessionId = ctx.registry.register(session, ownerId);

  // Wire the session's events to the owner. Listeners are released
  // implicitly when the session is closed (the AsrSession itself
  // drops its listener sets on close, but we don't depend on that —
  // the worst case is one extra dispatch into a closed channel).
  session.onFinal((ev) => {
    ctx.emitEvent(ownerId, { ...ev, sessionId, eventType: 'final' });
  });
  session.onError((err) => {
    ctx.emitEvent(ownerId, { sessionId, eventType: 'error', error: err.message });
  });

  return { sessionId };
}

export async function asrPushAudio(
  ctx: AsrIpcHandlerContext,
  ownerId: number,
  req: AsrPushAudioRequest,
): Promise<void> {
  const entry = ctx.registry.get(req.sessionId);
  if (!entry) {
    throw new AsrIpcError(`unknown session ${req.sessionId}`, 'not_found');
  }
  if (entry.ownerId !== ownerId) {
    throw new AsrIpcError(`session ${req.sessionId} not owned by caller`, 'forbidden');
  }
  if (req.pcm.byteLength % 2 !== 0) {
    throw new AsrIpcError('PCM payload has odd byte length', 'invalid');
  }
  // Reinterpret the Buffer/Uint8Array as Int16 — zero-copy on the
  // underlying ArrayBuffer.
  const pcm = new Int16Array(
    req.pcm.buffer,
    req.pcm.byteOffset,
    req.pcm.byteLength / 2,
  );
  await entry.session.pushAudio(pcm, req.endOfUtterance ?? false);
}

export async function asrCloseSession(
  ctx: AsrIpcHandlerContext,
  ownerId: number,
  req: AsrCloseSessionRequest,
): Promise<void> {
  const entry = ctx.registry.get(req.sessionId);
  if (!entry) return; // already gone; idempotent
  if (entry.ownerId !== ownerId) {
    throw new AsrIpcError(`session ${req.sessionId} not owned by caller`, 'forbidden');
  }
  ctx.registry.remove(req.sessionId);
  await entry.session.close();
}

/**
 * Close every session owned by the given owner. Called by the wire-up
 * when a renderer goes away. Errors during individual close() calls
 * are swallowed — the session is already abandoned, the only
 * remaining job is freeing the broker's reference count.
 */
export async function asrCloseAllForOwner(
  ctx: AsrIpcHandlerContext,
  ownerId: number,
): Promise<void> {
  const removed = ctx.registry.removeAllForOwner(ownerId);
  await Promise.all(
    removed.map(({ session }) =>
      session.close().catch(() => {
        // intentionally swallowed — nothing useful to do here
      }),
    ),
  );
}

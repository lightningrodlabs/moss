// Electron-aware glue between the broker / handlers and the running
// Moss main process. This file is the only place in the asr module
// that imports `electron`. Everything else is plain Node.
//
// Registers:
//   - the broker singleton (initAsrService)
//   - three ipcMain handlers (open, push, close)
//   - per-renderer cleanup (close sessions when webContents goes away)
//   - shutdown on app quit
//
// Call once from src/main/index.ts inside app.whenReady() before
// renderers can land their first IPC.

import { app, BrowserWindow, ipcMain, webContents } from 'electron';

import {
  defaultModelPath,
  getAsrBroker,
  getAsrCapabilities,
  initAsrService,
  shutdownAsrService,
} from './asrService';
import {
  AsrCloseSessionRequest,
  AsrIpcHandlerContext,
  AsrOpenSessionRequest,
  AsrPushAudioRequest,
  asrCloseAllForOwner,
  asrCloseSession,
  asrGetCapabilities,
  asrOpenSession,
  asrPushAudio,
  asrStatus,
  asrWarmUp,
} from './ipcHandlers';
import { SessionRegistry } from './sessionRegistry';

/** Where a line of whisper-server output came from. */
export type AsrSidecarLogStream = 'stdout' | 'stderr';

export interface AsrWireUpConfig {
  /** Absolute path to the resources/bins directory. */
  binariesDir: string;
  /**
   * Absolute path to the resources directory (the parent of
   * binariesDir). Used to locate the bundled model at
   * <resourcesPath>/models/ggml-base.en.bin. Optional: when omitted,
   * the bundled-model lookup step is skipped and the resolver falls
   * through to the dev spike path.
   */
  resourcesPath?: string;
  /**
   * whisper-server version, from `moss.config.json#whisperServer`. Used
   * to construct the bundled binary filename
   * (resources/bins/whisper-server-v<version><exe>).
   */
  whisperServerVersion: string;
  /**
   * Optional model override. If omitted, defaults to $MOSS_ASR_MODEL,
   * then to a bundled model under `resourcesPath`, then to the M0
   * spike artifact under `repoRoot` (dev only).
   */
  modelPath?: string;
  /** Used to compute the default model path. Required when modelPath is omitted. */
  repoRoot?: string;
  /** Override the broker's idle unload timeout. */
  idleTimeoutMs?: number;
  /**
   * Override the capabilities `latencyTier` reported to applets.
   * Defaults to $MOSS_ASR_LATENCY_TIER if set to fast/ok/slow, else 'ok'.
   */
  latencyTier?: 'fast' | 'ok' | 'slow';
  /**
   * Receives whisper-server's stdout/stderr output. Defaults to
   * writing stderr to the Moss process's stderr and dropping stdout;
   * the production caller routes both into the Moss log pipeline.
   */
  onLog?: (stream: AsrSidecarLogStream, chunk: string) => void;
}

const defaultOnLog = (stream: AsrSidecarLogStream, chunk: string): void => {
  // whisper-server is verbose at startup; stderr is where problems show up.
  if (stream === 'stderr') process.stderr.write(`[whisper-server] ${chunk}`);
};

let registered = false;

/**
 * One-shot wire-up. Idempotent — second call is a no-op so accidental
 * re-init in dev hot-reload can't double-register handlers.
 */
export function registerAsrIpc(config: AsrWireUpConfig): void {
  if (registered) return;
  registered = true;

  const modelPath =
    config.modelPath ?? defaultModelPath(config.repoRoot ?? process.cwd(), config.resourcesPath);

  const latencyTier = config.latencyTier ?? readLatencyTierEnv();
  initAsrService({
    binariesDir: config.binariesDir,
    whisperServerVersion: config.whisperServerVersion,
    isPackaged: app.isPackaged,
    modelPath,
    idleTimeoutMs: config.idleTimeoutMs,
    onLog: config.onLog ?? defaultOnLog,
    latencyTier,
    // Every window may be hosting an applet that is waiting on the
    // sidecar, so the status goes to all of them.
    onStatusChange: (status) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('asr-status', status);
      }
    },
  });

  const registry = new SessionRegistry();
  const ctx: AsrIpcHandlerContext = {
    // Routed through getAsrBroker() so a deferred resolver failure
    // (no whisper-server binary) throws at session-open time with the
    // helpful error message, instead of crashing app startup.
    getBroker: () => getAsrBroker(),
    registry,
    emitEvent: (ownerId, event) => {
      const wc = webContents.fromId(ownerId);
      if (wc && !wc.isDestroyed()) wc.send('asr-event', event);
    },
    getCapabilities: () => getAsrCapabilities(),
    // A session whose renderer is gone cannot receive events; lets the
    // handlers treat such owners as closed rather than emitting into
    // the void.
    isOwnerAlive: (ownerId) => {
      const wc = webContents.fromId(ownerId);
      return !!wc && !wc.isDestroyed();
    },
  };

  ipcMain.handle('asr-capabilities', () => asrGetCapabilities(ctx));
  ipcMain.handle('asr-warm-up', () => asrWarmUp(ctx));
  ipcMain.handle('asr-status', () => asrStatus(ctx));
  ipcMain.handle('asr-open-session', (e, req: AsrOpenSessionRequest) =>
    asrOpenSession(ctx, e.sender.id, req),
  );
  ipcMain.handle('asr-push-audio', (e, req: AsrPushAudioRequest) =>
    asrPushAudio(ctx, e.sender.id, req),
  );
  ipcMain.handle('asr-close-session', (e, req: AsrCloseSessionRequest) =>
    asrCloseSession(ctx, e.sender.id, req),
  );

  // Renderer cleanup: when a webContents goes away (window closed,
  // page navigated) drop all of its sessions. Applet iframes share the
  // main window's webContents, so a tool closing its view is handled
  // by the renderer-side gates, not here.
  app.on('web-contents-created', (_event, wc) => {
    wc.once('destroyed', () => {
      void asrCloseAllForOwner(ctx, wc.id);
    });
  });

  // Sidecar cleanup. Use the existing 'quit' hook (moss already has
  // one — Electron supports multiple listeners). Fire-and-forget; the
  // process will exit before the broker can hang.
  app.on('quit', () => {
    void shutdownAsrService();
  });
}

/**
 * Test-only: forget that wire-up has run, so a subsequent call
 * actually re-registers. NOT for production.
 */
export function _resetAsrWireUpForTests(): void {
  registered = false;
}

/** True if registerAsrIpc() has been called. Diagnostic helper. */
export function isAsrIpcRegistered(): boolean {
  return registered;
}

/**
 * Internal helper for the e2e harness. Returns the BrowserWindow that
 * owns a given webContents id, or undefined.
 */
export function findWindowForOwner(ownerId: number): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((w) => w.webContents.id === ownerId);
}

function readLatencyTierEnv(): 'fast' | 'ok' | 'slow' | undefined {
  const raw = process.env.MOSS_ASR_LATENCY_TIER?.trim().toLowerCase();
  return raw === 'fast' || raw === 'ok' || raw === 'slow' ? raw : undefined;
}

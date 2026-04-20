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
} from './ipcHandlers';
import { SessionRegistry } from './sessionRegistry';

/**
 * Fallback whisper.cpp version used when the caller does not pass one.
 * Kept in sync with `moss.config.json#whisperServer` — production
 * callers (src/main/index.ts) read that file and pass the value in;
 * this default only covers legacy test paths that construct a wire-up
 * without going through the config loader.
 */
export const WHISPER_SERVER_VERSION = '1.8.4';

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
   * whisper-server version. Used to construct the bundled binary
   * filename (resources/bins/whisper-server-v<version><exe>). When
   * omitted, falls back to WHISPER_SERVER_VERSION.
   */
  whisperServerVersion?: string;
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
}

let registered = false;

/**
 * One-shot wire-up. Idempotent — second call is a no-op so accidental
 * re-init in dev hot-reload can't double-register handlers.
 */
export function registerAsrIpc(config: AsrWireUpConfig): void {
  if (registered) return;
  registered = true;

  const modelPath =
    config.modelPath ??
    defaultModelPath(config.repoRoot ?? process.cwd(), config.resourcesPath);

  const latencyTier = config.latencyTier ?? readLatencyTierEnv();
  const broker = initAsrService({
    binariesDir: config.binariesDir,
    whisperServerVersion: config.whisperServerVersion ?? WHISPER_SERVER_VERSION,
    isPackaged: app.isPackaged,
    modelPath,
    idleTimeoutMs: config.idleTimeoutMs,
    onLog: (stream, chunk) => {
      // whisper-server is verbose at startup. Drop stdout, keep stderr
      // visible — that's where actual problems show up.
      if (stream === 'stderr') process.stderr.write(`[whisper-server] ${chunk}`);
    },
    latencyTier,
  });

  const registry = new SessionRegistry();
  const ctx: AsrIpcHandlerContext = {
    getBroker: () => broker,
    registry,
    emitEvent: (ownerId, event) => {
      const wc = webContents.fromId(ownerId);
      if (wc && !wc.isDestroyed()) wc.send('asr-event', event);
    },
    getCapabilities: () => getAsrCapabilities(),
  };

  ipcMain.handle('asr-capabilities', () => asrGetCapabilities(ctx));
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
  // page navigated, applet iframe destroyed) drop all of its sessions.
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

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
  asrOpenSession,
  asrPushAudio,
} from './ipcHandlers';
import { SessionRegistry } from './sessionRegistry';

/**
 * Pinned to the nixpkgs whisper-cpp version used in the M0 spike. The
 * resolver looks for `whisper-server-v<this>` in resources/bins; in
 * dev that file doesn't exist and the resolver falls back to the
 * `nix shell nixpkgs#whisper-cpp -c whisper-server` invocation. When
 * the per-platform binary fetch pipeline lands, this constant moves
 * to moss.config.json alongside `holochain` and `kitsune2BootstrapSrv`.
 */
export const WHISPER_SERVER_VERSION = '1.8.4';

export interface AsrWireUpConfig {
  /** Absolute path to the resources/bins directory. */
  binariesDir: string;
  /**
   * Optional model override. If omitted, defaults to $MOSS_ASR_MODEL,
   * then to the M0 spike artifact under `repoRoot`.
   */
  modelPath?: string;
  /** Used to compute the default model path. Required when modelPath is omitted. */
  repoRoot?: string;
  /** Override the broker's idle unload timeout. */
  idleTimeoutMs?: number;
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
    config.modelPath ?? defaultModelPath(config.repoRoot ?? process.cwd());

  const broker = initAsrService({
    binariesDir: config.binariesDir,
    whisperServerVersion: WHISPER_SERVER_VERSION,
    isPackaged: app.isPackaged,
    modelPath,
    idleTimeoutMs: config.idleTimeoutMs,
    onLog: (stream, chunk) => {
      // whisper-server is verbose at startup. Drop stdout, keep stderr
      // visible — that's where actual problems show up.
      if (stream === 'stderr') process.stderr.write(`[whisper-server] ${chunk}`);
    },
  });

  const registry = new SessionRegistry();
  const ctx: AsrIpcHandlerContext = {
    getBroker: () => broker,
    registry,
    emitEvent: (ownerId, event) => {
      const wc = webContents.fromId(ownerId);
      if (wc && !wc.isDestroyed()) wc.send('asr-event', event);
    },
  };

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

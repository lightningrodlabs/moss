// Electron-aware glue between the broker / handlers and the running
// Moss main process. This file is the only place in the asr module
// that imports `electron`. Everything else is plain Node.
//
// Registers:
//   - the broker singleton (initAsrService)
//   - the session ipcMain handlers (capabilities, warm-up, status,
//     open, push, close, open-session-count)
//   - the model-management ipcMain handlers (list, download,
//     cancel-download, delete, select) and the download-progress and download-ended pushes
//   - per-renderer cleanup (close sessions when webContents goes away)
//   - shutdown on app quit
//
// Call once from src/main/index.ts inside app.whenReady() before
// renderers can land their first IPC.

import { app, BrowserWindow, ipcMain, webContents } from 'electron';
import path from 'node:path';

import {
  getAsrBroker,
  getAsrCapabilities,
  initAsrService,
  setAsrModelPath,
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
  asrOpenSessionCount,
  asrPushAudio,
  asrStatus,
  asrWarmUp,
} from './ipcHandlers';
import { catalogEntryForPath } from './modelCatalog';
import { ModelDownloader } from './modelDownloader';
import {
  AsrModelIpcContext,
  asrModelCancelDownload,
  asrModelDelete,
  asrModelDownloadAnnounced,
  asrModelSelect,
  asrModelsList,
} from './modelIpcHandlers';
import { AsrModelStore } from './modelStore';
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
  /** <profileDataDir>/models: where downloaded models go. */
  modelsDir: string;
  /** <profileConfigDir>: holds the user's model choice. */
  configDir: string;
  /** Repo root, for the dev-only spike model directory. */
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

  const store = new AsrModelStore({
    modelsDir: config.modelsDir,
    configDir: config.configDir,
    bundledModelsDir: config.resourcesPath ? path.join(config.resourcesPath, 'models') : undefined,
    spikeModelsDir: config.repoRoot ? path.join(config.repoRoot, 'spikes/asr-m0/models') : undefined,
  });
  const modelPath = store.resolveActiveModelPath();
  const modelEntry = modelPath ? catalogEntryForPath(modelPath) : undefined;

  const broadcast = (channel: string, payload: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(channel, payload);
    }
  };

  const latencyTier = config.latencyTier ?? readLatencyTierEnv();
  initAsrService({
    binariesDir: config.binariesDir,
    whisperServerVersion: config.whisperServerVersion,
    isPackaged: app.isPackaged,
    modelPath,
    modelStartTimeoutMs: modelEntry?.startTimeoutMs,
    idleTimeoutMs: config.idleTimeoutMs,
    onLog: config.onLog ?? defaultOnLog,
    latencyTier,
    // Every window may be hosting an applet that is waiting on the
    // sidecar, so the status goes to all of them.
    onStatusChange: (status) => broadcast('asr-status', status),
  });

  const modelCtx: AsrModelIpcContext = {
    store,
    downloader: new ModelDownloader({
      modelsDir: store.modelsDir,
      onProgress: (p) => broadcast('asr-model-download-progress', p),
    }),
    applyModelPath: setAsrModelPath,
  };

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
  ipcMain.handle('asr-open-session-count', () => asrOpenSessionCount(ctx));

  ipcMain.handle('asr-models-list', () => asrModelsList(modelCtx));
  ipcMain.handle('asr-model-download', (_e, req: { id: string }) =>
    asrModelDownloadAnnounced(modelCtx, req, (ended) => broadcast('asr-model-download-ended', ended)),
  );
  ipcMain.handle('asr-model-cancel-download', (_e, req: { id: string }) =>
    asrModelCancelDownload(modelCtx, req),
  );
  ipcMain.handle('asr-model-delete', (_e, req: { id: string }) => asrModelDelete(modelCtx, req));
  ipcMain.handle('asr-model-select', (_e, req: { id: string }) => asrModelSelect(modelCtx, req));

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

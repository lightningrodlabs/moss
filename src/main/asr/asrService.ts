// Singleton accessor for the AsrBroker. Sits between the wire-up code
// in src/main/index.ts (which knows about Electron paths and lifecycle)
// and the broker itself (which is Electron-free).
//
// The wire-up code calls initAsrService(...) once at app start with
// Electron-derived inputs; everything else (IPC handlers, etc) just
// asks for the broker via getAsrBroker(). On app quit, shutdown() is
// called to stop the sidecar cleanly.
//
// We keep this a plain singleton instead of routing through an
// existing moss store because:
//   - the broker has its own lifecycle (lazy load, idle unload) that
//     doesn't fit the reactive-store shape
//   - the sidecar process is owned by main, not the renderer

import path from 'node:path';

import { AsrBroker } from './broker';
import { resolveWhisperServerCommand } from './binaryResolver';

export interface AsrServiceConfig {
  /** Absolute path to the directory holding bundled binaries (resources/bins). */
  binariesDir: string;
  /** Version string used to locate the bundled whisper-server binary. */
  whisperServerVersion: string;
  /** True when running inside a packaged app.asar; disables nix fallback. */
  isPackaged: boolean;
  /**
   * Absolute path to the ggml model file (.bin). For the e2e dev flow,
   * the wire-up code reads this from $MOSS_ASR_MODEL or a default that
   * points at the M0 spike artifact.
   */
  modelPath: string;
  /**
   * Idle timeout before the sidecar unloads after the last session
   * closes. Defaults to AsrBroker's default (5 min).
   */
  idleTimeoutMs?: number;
  /** Optional log sink for sidecar stdout/stderr. */
  onLog?: (stream: 'stdout' | 'stderr', chunk: string) => void;
}

let broker: AsrBroker | null = null;
let initialized = false;

/**
 * Wire up the broker with everything it needs. Idempotent — second
 * call is a no-op. Required before getAsrBroker() will succeed.
 */
export function initAsrService(config: AsrServiceConfig): AsrBroker {
  if (initialized && broker) return broker;
  const resolved = resolveWhisperServerCommand({
    binariesDir: config.binariesDir,
    whisperServerVersion: config.whisperServerVersion,
    isPackaged: config.isPackaged,
  });
  broker = new AsrBroker({
    server: {
      command: resolved.command,
      modelPath: config.modelPath,
      onLog: config.onLog,
    },
    idleTimeoutMs: config.idleTimeoutMs,
  });
  initialized = true;
  return broker;
}

/**
 * Look up the singleton broker. Throws if initAsrService() hasn't
 * been called yet — this is intentional: silently lazy-initing here
 * would hide wiring bugs in main.
 */
export function getAsrBroker(): AsrBroker {
  if (!broker) {
    throw new Error('AsrBroker not initialized; call initAsrService() first');
  }
  return broker;
}

/** True if initAsrService() has run. */
export function isAsrServiceInitialized(): boolean {
  return initialized;
}

/**
 * Tear down the broker, free the sidecar process. Safe to call from
 * an Electron `before-quit` handler. Idempotent.
 */
export async function shutdownAsrService(): Promise<void> {
  if (!broker) {
    initialized = false;
    return;
  }
  const b = broker;
  broker = null;
  initialized = false;
  await b.destroy();
}

/**
 * Test-only: forget the singleton state without going through
 * shutdown. Used by unit tests to start clean between cases.
 * Production code should not call this.
 */
export function _resetAsrServiceForTests(): void {
  broker = null;
  initialized = false;
}

/**
 * Default model path for dev. Looks at $MOSS_ASR_MODEL first; falls
 * back to the M0 spike artifact. Returned as a function so test code
 * can override the env without the singleton caching the answer.
 */
export function defaultModelPath(repoRoot: string): string {
  const fromEnv = process.env.MOSS_ASR_MODEL;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  return path.join(repoRoot, 'spikes/asr-m0/models/ggml-base.en.bin');
}

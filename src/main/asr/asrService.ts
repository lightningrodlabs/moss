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

import type { LocalModelCapabilities } from '@theweave/api';

import { AsrBroker, type AsrHostStatus } from './broker';
import { resolveWhisperServerCommand, WhisperCommandResolveError } from './binaryResolver';
import { computeAsrCapabilities } from './capabilities';
import type { WhisperServerConfig } from './types';
import type { WhisperServer } from './whisperServer';

import { BUNDLED_ASR_MODEL_FILENAME } from './modelStore';

export { BUNDLED_ASR_MODEL_FILENAME };

export interface AsrServiceConfig {
  /** Absolute path to the directory holding bundled binaries (resources/bins). */
  binariesDir: string;
  /** Version string used to locate the bundled whisper-server binary. */
  whisperServerVersion: string;
  /** True when running inside a packaged app.asar; disables nix fallback. */
  isPackaged: boolean;
  /**
   * Absolute path to the ggml model file (.bin), or null when no model
   * is present on this install. Without a model the service reports
   * `available: false` and refuses to hand out a broker.
   */
  modelPath: string | null;
  /**
   * Idle timeout before the sidecar unloads after the last session
   * closes. Defaults to AsrBroker's default (5 min).
   */
  idleTimeoutMs?: number;
  /** Optional log sink for sidecar stdout/stderr. */
  onLog?: (stream: 'stdout' | 'stderr', chunk: string) => void;
  /** Override the capabilities `latencyTier` reported to applets. */
  latencyTier?: 'fast' | 'ok' | 'slow';
  /** Readiness budget for the configured model, from the catalog. */
  modelStartTimeoutMs?: number;
  /** Receives sidecar status transitions for the shell's indicator. */
  onStatusChange?: (status: AsrHostStatus) => void;
  /** Test seam: substitutes the sidecar the broker spawns. */
  serverFactory?: (config: WhisperServerConfig) => WhisperServer;
}

let broker: AsrBroker | null = null;
let initialized = false;
let serviceConfig: AsrServiceConfig | null = null;
let currentModelPath: string | null = null;
let currentStartTimeoutMs: number | undefined;
/** Readiness floor the resolved command itself needs (the nix fallback may fetch a closure first). */
let commandStartTimeoutMs: number | undefined;
/** Set when whisper-server could not be located; the broker can never exist until a restart. */
let resolveError: WhisperCommandResolveError | null = null;

export function initAsrService(config: AsrServiceConfig): AsrBroker | null {
  if (initialized) return broker;
  initialized = true;
  serviceConfig = config;
  currentModelPath = config.modelPath;
  currentStartTimeoutMs = config.modelStartTimeoutMs;
  ensureBroker();
  return broker;
}

/**
 * Build the broker if a model and a sidecar command are both available.
 * Safe to call repeatedly; a missing model is not an error here because
 * the user can download one later.
 */
function ensureBroker(): void {
  if (broker || resolveError || !serviceConfig || currentModelPath === null) return;
  try {
    const resolved = resolveWhisperServerCommand({
      binariesDir: serviceConfig.binariesDir,
      whisperServerVersion: serviceConfig.whisperServerVersion,
      isPackaged: serviceConfig.isPackaged,
    });
    commandStartTimeoutMs = resolved.startTimeoutMs;
    broker = new AsrBroker({
      server: serverConfigFor(resolved.command),
      idleTimeoutMs: serviceConfig.idleTimeoutMs,
      onStatusChange: serviceConfig.onStatusChange,
      serverFactory: serviceConfig.serverFactory,
    });
  } catch (err) {
    if (err instanceof WhisperCommandResolveError) {
      resolveError = err;
      return;
    }
    throw err;
  }
}

/** The sidecar config for the current model: the larger of the command's and the model's readiness budgets. */
function serverConfigFor(command: readonly string[]): WhisperServerConfig {
  const timeouts = [commandStartTimeoutMs, currentStartTimeoutMs].filter(
    (t): t is number => t !== undefined,
  );
  return {
    command,
    modelPath: currentModelPath ?? '',
    onLog: serviceConfig?.onLog,
    startTimeoutMs: timeouts.length ? Math.max(...timeouts) : undefined,
  };
}

/**
 * Switch the model the sidecar loads. With a broker this swaps the
 * running sidecar; without one it tries to create it, so a model
 * downloaded after startup becomes usable without a restart.
 */
export async function setAsrModelPath(
  modelPath: string | null,
  startTimeoutMs?: number,
): Promise<void> {
  currentModelPath = modelPath;
  currentStartTimeoutMs = startTimeoutMs;
  if (broker) {
    if (modelPath === null) {
      const b = broker;
      broker = null;
      b.abortSessions(new Error('speech model changed'));
      await b.destroy();
      return;
    }
    await broker.setServerConfig(serverConfigFor(broker.serverConfig.command));
    return;
  }
  ensureBroker();
}

export function getAsrModelPath(): string | null {
  return currentModelPath;
}

/** Capabilities for the model that is configured right now. Unavailable until the broker can run it. */
export function getAsrCapabilities(): LocalModelCapabilities {
  const usable = broker !== null && currentModelPath !== null;
  return computeAsrCapabilities({
    modelPath: usable ? currentModelPath : null,
    latencyTier: serviceConfig?.latencyTier,
  });
}

export function getAsrBroker(): AsrBroker {
  if (!initialized) {
    throw new Error('AsrBroker not initialized; call initAsrService() first');
  }
  if (resolveError) throw resolveError;
  if (currentModelPath === null) {
    throw new Error(
      'No ASR model is installed. Download one under Settings > Services > Transcription, set $MOSS_ASR_MODEL, or bundle resources/models/' +
        BUNDLED_ASR_MODEL_FILENAME,
    );
  }
  if (!broker) {
    throw new Error('AsrBroker not initialized; call initAsrService() first');
  }
  return broker;
}

export function isAsrServiceInitialized(): boolean {
  return initialized;
}

export async function shutdownAsrService(): Promise<void> {
  const b = broker;
  resetState();
  if (b) await b.destroy();
}

export function _resetAsrServiceForTests(): void {
  resetState();
}

function resetState(): void {
  broker = null;
  initialized = false;
  serviceConfig = null;
  resolveError = null;
  currentModelPath = null;
  currentStartTimeoutMs = undefined;
  commandStartTimeoutMs = undefined;
}

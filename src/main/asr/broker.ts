// AsrBroker — owns the WhisperServer lifecycle on behalf of multiple
// AsrSessions.
//
// Responsibilities:
//   - Lazy-load the model on first openSession() call. Subsequent
//     concurrent calls share the in-flight start.
//   - Reference-count open sessions. While ≥ 1 session is open, the
//     server stays alive; when the count drops to zero, schedule an
//     idle unload after a configurable timeout.
//   - Cancel a pending unload if a new session arrives before it fires.
//   - Surface a serial transcription contract: sessions get the same
//     server instance and the WhisperServer wrapper handles one
//     transcribe() at a time. (Concurrent transcribe() calls against
//     the same whisper-server are not supported by the underlying
//     binary.)
//
// What this does NOT do (deferred):
//   - Multiple model variants loaded simultaneously. v1 = single
//     active model, swap = unload + load.
//   - Cross-process isolation. A future revision moves the server (and
//     potentially this broker) into an Electron utilityProcess so
//     model OOM doesn't take down Moss main. The interface here is
//     designed to be the same either way.

import { AsrSession, AsrSessionOptions } from './session';
import { WhisperServerConfig, WhisperServerState } from './types';
import { WhisperServer } from './whisperServer';

export interface AsrBrokerConfig {
  /**
   * Per-server config used when the broker spawns the sidecar. The
   * broker passes this through to WhisperServer; the broker itself
   * does not interpret it (binary path resolution lives upstream).
   */
  server: WhisperServerConfig;

  /**
   * How long to keep the model loaded after the last session closes,
   * in milliseconds. Default 5 minutes. Pass 0 to unload immediately.
   */
  idleTimeoutMs?: number;

  /**
   * Test seam — lets unit tests inject a fake WhisperServer instead of
   * spawning a real subprocess. Production code should leave this as
   * the default.
   */
  serverFactory?: (config: WhisperServerConfig) => WhisperServer;
}

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1_000;

export class AsrBroker {
  private server: WhisperServer | null = null;
  private starting: Promise<WhisperServer> | null = null;
  private sessionCount = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  /** Tracks the in-flight unload, if any, so concurrent acquire() can wait it out. */
  private unloading: Promise<void> | null = null;
  private destroyed = false;

  private readonly idleTimeoutMs: number;
  private readonly factory: (config: WhisperServerConfig) => WhisperServer;

  constructor(private readonly config: AsrBrokerConfig) {
    this.idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.factory = config.serverFactory ?? ((c) => new WhisperServer(c));
  }

  /**
   * Open a new ASR session. Triggers a model load if no server is
   * currently running. Resolves once the server is ready and the
   * session is wired up.
   */
  async openSession(opts?: AsrSessionOptions): Promise<AsrSession> {
    if (this.destroyed) {
      throw new Error('AsrBroker is destroyed; cannot open new sessions');
    }
    const server = await this.acquire();
    return new AsrSession(server, () => this.release(), opts);
  }

  /** Number of currently-open sessions. Diagnostic / test helper. */
  get openSessionCount(): number {
    return this.sessionCount;
  }

  /** Whether a server is currently loaded. Diagnostic / test helper. */
  get isLoaded(): boolean {
    return this.server !== null;
  }

  serverState(): WhisperServerState {
    return this.server?.state ?? 'idle';
  }

  /**
   * Tear the broker down. Closes the underlying server (if any) and
   * blocks new openSession() calls. Does NOT close in-flight sessions
   * — the caller is expected to close those first.
   */
  async destroy(): Promise<void> {
    this.destroyed = true;
    this.cancelIdleTimer();
    if (this.unloading) {
      await this.unloading;
    }
    if (this.server) {
      const s = this.server;
      this.server = null;
      await s.stop();
    }
  }

  private async acquire(): Promise<WhisperServer> {
    this.cancelIdleTimer();
    // If we're mid-unload, let it complete and then start fresh.
    if (this.unloading) {
      await this.unloading;
    }
    if (this.server && this.server.state === 'ready') {
      this.sessionCount++;
      return this.server;
    }
    if (this.starting) {
      const s = await this.starting;
      this.sessionCount++;
      return s;
    }
    // Cold start.
    this.starting = (async () => {
      const s = this.factory(this.config.server);
      try {
        await s.start();
      } catch (err) {
        this.starting = null;
        throw err;
      }
      this.server = s;
      this.starting = null;
      return s;
    })();
    const s = await this.starting;
    this.sessionCount++;
    return s;
  }

  private async release(): Promise<void> {
    this.sessionCount = Math.max(0, this.sessionCount - 1);
    if (this.sessionCount > 0) return;
    if (this.idleTimeoutMs <= 0) {
      await this.unload();
    } else {
      this.scheduleIdle();
    }
  }

  private scheduleIdle(): void {
    this.cancelIdleTimer();
    this.idleTimer = setTimeout(() => {
      void this.unload().catch(() => {
        // Errors during idle unload are logged by the server's onLog;
        // we don't have anywhere meaningful to surface them here in v1.
      });
    }, this.idleTimeoutMs);
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private async unload(): Promise<void> {
    // Race-safe: don't unload if a new session arrived after the timer
    // fired but before we ran.
    if (this.sessionCount > 0) return;
    const s = this.server;
    if (!s) return;
    this.server = null;
    this.unloading = s.stop().finally(() => {
      this.unloading = null;
    });
    await this.unloading;
  }
}

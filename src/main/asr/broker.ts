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
//     active model; setServerConfig() replaces it.
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

  /**
   * Called on every host status transition (idle → starting → ready →
   * idle). The shell shows a "starting" indicator from this.
   */
  onStatusChange?: (status: AsrHostStatus) => void;
}

/** Whether the shared sidecar is down, coming up, or serving. */
export type AsrHostStatus = 'idle' | 'starting' | 'ready';

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
  private lastStatus: AsrHostStatus = 'idle';

  private serverConfigValue: WhisperServerConfig;
  /** Sessions the broker handed out and has not yet released. */
  private readonly sessions = new Set<AsrSession>();
  /** Bumped on every config swap so a session whose cold start straddled the swap is not handed a stale server. */
  private generation = 0;

  constructor(private readonly config: AsrBrokerConfig) {
    this.serverConfigValue = config.server;
    this.idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.factory = config.serverFactory ?? ((c) => new WhisperServer(c));
  }

  /** The config the next cold start will use. */
  get serverConfig(): WhisperServerConfig {
    return this.serverConfigValue;
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
    const generation = this.generation;
    const server = await this.acquire();
    const session = new AsrSession(server, () => this.releaseSession(session), opts);
    this.sessions.add(session);
    if (generation !== this.generation) {
      session.abort(new Error('speech model changed'));
    }
    return session;
  }

  /**
   * Point the broker at a different model. Sessions that are open are
   * ended with an error so the user's choice takes effect now rather
   * than after every tool happens to close; the next session cold-starts
   * the new model.
   */
  async setServerConfig(next: WhisperServerConfig): Promise<void> {
    this.serverConfigValue = next;
    this.generation += 1;
    if (this.starting) {
      await this.starting.catch(() => undefined);
    }
    if (!this.server) return;
    const open = [...this.sessions];
    this.sessions.clear();
    this.sessionCount = 0;
    this.cancelIdleTimer();
    for (const s of open) s.abort(new Error('speech model changed'));
    const server = this.server;
    this.server = null;
    this.publishStatus();
    this.unloading = server.stop().finally(() => {
      this.unloading = null;
    });
    await this.unloading;
  }

  /**
   * Bring the sidecar up without opening a session, so the cold start
   * overlaps with whatever the user is doing before they need it. The
   * idle timer reclaims it if no session follows.
   */
  async warmUp(): Promise<void> {
    if (this.destroyed) {
      throw new Error('AsrBroker is destroyed; cannot warm up');
    }
    const generation = this.generation;
    await this.acquire();
    // A swap during the start already reset the count and stopped that server.
    if (generation !== this.generation) return;
    await this.release();
  }

  /** Down, coming up, or serving. */
  get status(): AsrHostStatus {
    if (this.starting) return 'starting';
    if (this.server && this.server.state === 'ready') return 'ready';
    return 'idle';
  }

  /** Report the current status to the listener when it differs from the last report. */
  private publishStatus(): void {
    const next = this.status;
    if (next === this.lastStatus) return;
    this.lastStatus = next;
    this.config.onStatusChange?.(next);
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
    // A cold start that is still in flight will hand us its server once
    // it finishes; wait for it so the sidecar is stopped rather than orphaned.
    if (this.starting) {
      await this.starting.catch(() => undefined);
    }
    if (this.server) {
      const s = this.server;
      this.server = null;
      await s.stop();
    }
    this.publishStatus();
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
      this.assertAlive();
      this.sessionCount++;
      return s;
    }
    // Cold start.
    this.starting = (async () => {
      const s = this.factory(this.serverConfigValue);
      try {
        await s.start();
      } catch (err) {
        this.starting = null;
        this.publishStatus();
        throw err;
      }
      this.server = s;
      this.starting = null;
      this.publishStatus();
      return s;
    })();
    this.publishStatus();
    const s = await this.starting;
    this.assertAlive();
    this.sessionCount++;
    return s;
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error('AsrBroker has been destroyed');
    }
  }

  /** A session the broker already forgot (aborted during a swap) must not release twice. */
  private async releaseSession(session: AsrSession): Promise<void> {
    if (!this.sessions.delete(session)) return;
    await this.release();
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
    this.publishStatus();
    this.unloading = s.stop().finally(() => {
      this.unloading = null;
    });
    await this.unloading;
  }
}

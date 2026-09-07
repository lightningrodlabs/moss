/**
 * Every renderer fetch of the web tool library (curation lists, developer
 * collective tool lists) goes through one gate so that an offline machine
 * pays for the discovery once, briefly, and then every dependent screen
 * degrades immediately instead of each hanging on its own DNS or connect
 * timeout.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ToolLibraryUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolLibraryUnreachableError';
  }
}

export type ToolLibraryGateOptions = {
  fetchImpl?: FetchLike;
  now?: () => number;
  /** A browser-level hint that there is no network at all; skips the probe. */
  onLine?: () => boolean;
  /** How long one library request may take before it counts as unreachable. */
  timeoutMs?: number;
  /** How long, after a failure, requests are refused without trying the network. */
  offlineHoldMs?: number;
};

export class ToolLibraryGate {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly onLine: () => boolean;
  readonly timeoutMs: number;
  readonly offlineHoldMs: number;
  private offlineUntil: number | undefined;

  constructor(options: ToolLibraryGateOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => Date.now());
    this.onLine =
      options.onLine ??
      (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.offlineHoldMs = options.offlineHoldMs ?? 30_000;
  }

  /** True while a recent failure means the library is treated as unreachable. */
  isOffline(): boolean {
    if (!this.onLine()) return true;
    return this.offlineUntil !== undefined && this.now() < this.offlineUntil;
  }

  /** Forget a recorded failure so the next request probes the network again. */
  reset(): void {
    this.offlineUntil = undefined;
  }

  /**
   * Fetches like `fetch`, but refuses immediately while the library is known
   * unreachable, bounds the request by the timeout, and records a network-level
   * failure so later callers skip the wait. An HTTP error response is returned,
   * not thrown: the server answered, so the library is reachable.
   */
  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    if (this.isOffline()) {
      throw new ToolLibraryUnreachableError(
        `Tool library treated as unreachable (recent failure or no network): ${url}`,
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      this.offlineUntil = undefined;
      return response;
    } catch (e) {
      this.offlineUntil = this.now() + this.offlineHoldMs;
      const reason = controller.signal.aborted ? `no response within ${this.timeoutMs}ms` : `${e}`;
      throw new ToolLibraryUnreachableError(`Tool library unreachable (${reason}): ${url}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** The renderer's shared gate. Tests construct their own with injected fakes. */
export const toolLibraryFetch = new ToolLibraryGate();

import type { InstalledAppId } from '@holochain/client';
import type { NetworkMetricsDump } from './network-metrics-types.js';

/** The one conductor call the poller makes, so tests can stand in for AppWebsocket. */
export interface MetricsSource {
  dumpNetworkMetrics(req: { include_dht_summary: boolean }): Promise<NetworkMetricsDump>;
}

/** Starts repeated ticks and returns a function that stops them. */
export type StartTimer = (tick: () => Promise<void>, intervalMs: number) => () => void;

interface Subscription {
  includeDhtSummary: boolean;
  onMetrics: (metrics: NetworkMetricsDump) => void;
  onError?: (error: unknown) => void;
}

/**
 * The renderer's single caller of dumpNetworkMetrics. Every view that wants
 * metrics subscribes here, so each app is polled at most once per tick no
 * matter how many views watch it, and nothing is polled when nobody watches.
 */
export class NetworkMetricsPoller {
  private _subscriptions = new Map<InstalledAppId, Set<Subscription>>();
  private _stopTimer: (() => void) | undefined;
  /** Apps whose call is still open; they sit out ticks until it returns. */
  private _inFlight = new Set<InstalledAppId>();

  constructor(
    private _getSource: (appId: InstalledAppId) => Promise<MetricsSource>,
    private _startTimer: StartTimer,
    private _intervalMs: number,
  ) {}

  subscribe(
    appId: InstalledAppId,
    opts: { includeDhtSummary: boolean },
    onMetrics: (metrics: NetworkMetricsDump) => void,
    onError?: (error: unknown) => void,
  ): () => void {
    const subscription: Subscription = {
      includeDhtSummary: opts.includeDhtSummary,
      onMetrics,
      onError,
    };
    const forApp = this._subscriptions.get(appId) ?? new Set<Subscription>();
    forApp.add(subscription);
    this._subscriptions.set(appId, forApp);
    if (!this._stopTimer) {
      // The timer does not wait for slow apps, so one slow app never delays the others
      this._stopTimer = this._startTimer(() => {
        void this.tick();
        return Promise.resolve();
      }, this._intervalMs);
    }
    return () => {
      forApp.delete(subscription);
      if (forApp.size === 0) this._subscriptions.delete(appId);
      if (this._subscriptions.size === 0 && this._stopTimer) {
        this._stopTimer();
        this._stopTimer = undefined;
      }
    };
  }

  /**
   * Polls each watched app once, skipping any app whose previous call has
   * not returned yet. Resolves when the calls started by this tick finish.
   */
  tick(): Promise<void> {
    const polls = Array.from(this._subscriptions.entries())
      .filter(([appId]) => !this._inFlight.has(appId))
      .map(([appId, forApp]) => this._pollApp(appId, forApp));
    return Promise.all(polls).then(() => undefined);
  }

  private async _pollApp(appId: InstalledAppId, forApp: Set<Subscription>): Promise<void> {
    this._inFlight.add(appId);
    const includeDhtSummary = Array.from(forApp).some((s) => s.includeDhtSummary);
    try {
      const source = await this._getSource(appId);
      const metrics = await source.dumpNetworkMetrics({
        include_dht_summary: includeDhtSummary,
      });
      // Only views still subscribed when the answer arrives receive it
      for (const s of Array.from(forApp)) s.onMetrics(metrics);
    } catch (e) {
      for (const s of Array.from(forApp)) s.onError?.(e);
    } finally {
      this._inFlight.delete(appId);
    }
  }
}

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
  private _ticking: Promise<void> | undefined;

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
      this._stopTimer = this._startTimer(() => this.tick(), this._intervalMs);
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

  /** Polls every watched app once. A tick requested while one runs joins it. */
  tick(): Promise<void> {
    if (!this._ticking) {
      this._ticking = this._pollAll().finally(() => {
        this._ticking = undefined;
      });
    }
    return this._ticking;
  }

  private async _pollAll(): Promise<void> {
    await Promise.all(
      Array.from(this._subscriptions.entries()).map(async ([appId, forApp]) => {
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
        }
      }),
    );
  }
}

import { describe, expect, it, vi } from 'vitest';
import { NetworkMetricsPoller, MetricsSource } from './network-metrics-poller.js';
import type { NetworkMetricsDump } from './network-metrics-types.js';

const DUMP: NetworkMetricsDump = {};

function setup() {
  const calls: { appId: string; includeDhtSummary: boolean }[] = [];
  let resolveNext: (() => void) | undefined;
  let holdCalls = false;
  const getSource = async (appId: string): Promise<MetricsSource> => ({
    dumpNetworkMetrics: async (req) => {
      calls.push({ appId, includeDhtSummary: req.include_dht_summary });
      if (holdCalls) await new Promise<void>((r) => (resolveNext = r));
      return DUMP;
    },
  });
  const timer = { started: 0, stopped: 0 };
  const startTimer = () => {
    timer.started += 1;
    return () => {
      timer.stopped += 1;
    };
  };
  const poller = new NetworkMetricsPoller(getSource, startTimer, 2000);
  return {
    poller,
    calls,
    timer,
    hold: () => (holdCalls = true),
    release: () => resolveNext?.(),
  };
}

describe('NetworkMetricsPoller', () => {
  it('starts no timer until the first subscriber', () => {
    const { timer, poller } = setup();
    expect(timer.started).toBe(0);
    poller.subscribe('app1', { includeDhtSummary: false }, () => {});
    poller.subscribe('app2', { includeDhtSummary: false }, () => {});
    expect(timer.started).toBe(1);
  });

  it('makes one call per app per tick and asks for the DHT summary if any subscriber wants it', async () => {
    const { poller, calls } = setup();
    const a = vi.fn();
    const b = vi.fn();
    poller.subscribe('app1', { includeDhtSummary: false }, a);
    poller.subscribe('app1', { includeDhtSummary: true }, b);
    await poller.tick();
    expect(calls).toEqual([{ appId: 'app1', includeDhtSummary: true }]);
    expect(a).toHaveBeenCalledWith(DUMP);
    expect(b).toHaveBeenCalledWith(DUMP);
  });

  it('stops the timer and polls nothing after the last subscriber leaves', async () => {
    const { poller, calls, timer } = setup();
    const unsubscribe = poller.subscribe('app1', { includeDhtSummary: false }, () => {});
    unsubscribe();
    expect(timer.stopped).toBe(1);
    await poller.tick();
    expect(calls).toEqual([]);
  });

  it('reports a failing app to its subscribers and still polls the others', async () => {
    const onError = vi.fn();
    const ok = vi.fn();
    const poller = new NetworkMetricsPoller(
      async (appId) => ({
        dumpNetworkMetrics: async () => {
          if (appId === 'bad') throw new Error('conductor busy');
          return DUMP;
        },
      }),
      () => () => {},
      2000,
    );
    poller.subscribe('bad', { includeDhtSummary: false }, () => {}, onError);
    poller.subscribe('good', { includeDhtSummary: false }, ok);
    await poller.tick();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledWith(DUMP);
  });

  it('drops a result for a subscriber that left during the call', async () => {
    const { poller, hold, release } = setup();
    hold();
    const onMetrics = vi.fn();
    const unsubscribe = poller.subscribe('app1', { includeDhtSummary: false }, onMetrics);
    const ticking = poller.tick();
    await Promise.resolve();
    unsubscribe();
    release();
    await ticking;
    expect(onMetrics).not.toHaveBeenCalled();
  });

  it('does not start a second tick while one is running', async () => {
    const { poller, calls, hold, release } = setup();
    hold();
    poller.subscribe('app1', { includeDhtSummary: false }, () => {});
    const first = poller.tick();
    await Promise.resolve();
    const second = poller.tick();
    release();
    await Promise.all([first, second]);
    expect(calls).toHaveLength(1);
  });
});

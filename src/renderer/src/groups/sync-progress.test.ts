import { describe, expect, it } from 'vitest';
import { deriveSyncProgress, withKnownPeers } from './sync-progress.js';
import type {
  NetworkMetricsWithCounts,
  PeerMetaWithCounts,
} from '../network/network-metrics-types.js';

function metrics(opts: {
  peers?: Record<string, PeerMetaWithCounts>;
  localOpCount?: number;
  pending?: number;
  rounds?: number;
}): NetworkMetricsWithCounts {
  const pending_requests: Record<string, string[]> = {};
  for (let i = 0; i < (opts.pending ?? 0); i++) pending_requests[`op${i}`] = ['peer'];
  return {
    fetch_state_summary: { pending_requests } as NetworkMetricsWithCounts['fetch_state_summary'],
    gossip_state_summary: {
      accepted_rounds: Array.from({ length: opts.rounds ?? 0 }, () => ({
        session_with_peer: 'peer',
      })),
      dht_summary: {},
      peer_meta: opts.peers ?? {},
      local_op_count: opts.localOpCount,
    },
    local_agents: [],
  };
}

const NOW = 1_800_000_000_000;

describe('deriveSyncProgress', () => {
  it('reports no peers when nothing is known', () => {
    const p = deriveSyncProgress({
      previous: undefined,
      metrics: metrics({}),
      knownPeers: 0,
      now: NOW,
    });
    expect(p.stage).toBe('no-peers');
    expect(p.peersFound).toBe(0);
  });

  it('uses known peers before the first metrics snapshot', () => {
    const p = deriveSyncProgress({
      previous: undefined,
      metrics: undefined,
      knownPeers: 2,
      now: NOW,
    });
    expect(p.stage).toBe('connecting');
    expect(p.peersFound).toBe(2);
  });

  it('is syncing while a peer reports more ops than we hold', () => {
    const p = deriveSyncProgress({
      previous: undefined,
      metrics: metrics({
        peers: { a: { completed_rounds: 1, dht_op_count: 40 } },
        localOpCount: 10,
      }),
      knownPeers: 1,
      now: NOW,
    });
    expect(p.stage).toBe('syncing');
    expect(p.localOpCount).toBe(10);
    expect(p.highestPeerOpCount).toBe(40);
  });

  it('is syncing while fetches are pending or a round runs', () => {
    expect(
      deriveSyncProgress({
        previous: undefined,
        metrics: metrics({ pending: 3 }),
        knownPeers: 1,
        now: NOW,
      }).stage,
    ).toBe('syncing');
    expect(
      deriveSyncProgress({
        previous: undefined,
        metrics: metrics({ rounds: 1 }),
        knownPeers: 1,
        now: NOW,
      }).stage,
    ).toBe('syncing');
  });

  it('is caught up after a completed round with nothing left to fetch', () => {
    const p = deriveSyncProgress({
      previous: undefined,
      metrics: metrics({
        peers: { a: { completed_rounds: 2, dht_op_count: 10 } },
        localOpCount: 10,
      }),
      knownPeers: 1,
      now: NOW,
    });
    expect(p.stage).toBe('caught-up');
    expect(p.peersSyncedWith).toBe(1);
  });

  it('counts peers seen in gossip that agentInfo has not reported yet', () => {
    const p = deriveSyncProgress({
      previous: undefined,
      metrics: metrics({ peers: { a: { completed_rounds: 1 }, b: { completed_rounds: 1 } } }),
      knownPeers: 1,
      now: NOW,
    });
    expect(p.peersFound).toBe(2);
  });

  it('ignores tombstoned peers', () => {
    const p = deriveSyncProgress({
      previous: undefined,
      metrics: metrics({ peers: { a: { completed_rounds: 3, is_tombstone: true } } }),
      knownPeers: 0,
      now: NOW,
    });
    expect(p.stage).toBe('no-peers');
    expect(p.peersSyncedWith).toBe(0);
  });

  it('reports no op counts when the conductor omits them', () => {
    const p = deriveSyncProgress({
      previous: undefined,
      metrics: metrics({ peers: { a: { completed_rounds: 1 } } }),
      knownPeers: 1,
      now: NOW,
    });
    expect(p.localOpCount).toBeUndefined();
    expect(p.highestPeerOpCount).toBeUndefined();
    expect(p.stage).toBe('caught-up');
  });

  it('marks activity when we gain ops and keeps the old time when nothing moves', () => {
    const first = deriveSyncProgress({
      previous: undefined,
      metrics: metrics({
        peers: { a: { completed_rounds: 1, dht_op_count: 20 } },
        localOpCount: 5,
      }),
      knownPeers: 1,
      now: NOW,
    });
    const grew = deriveSyncProgress({
      previous: first,
      metrics: metrics({
        peers: { a: { completed_rounds: 1, dht_op_count: 20 } },
        localOpCount: 9,
      }),
      knownPeers: 1,
      now: NOW + 2000,
    });
    expect(grew.lastActivityAt).toBe(NOW + 2000);
    const still = deriveSyncProgress({
      previous: grew,
      metrics: metrics({
        peers: { a: { completed_rounds: 1, dht_op_count: 20 } },
        localOpCount: 9,
      }),
      knownPeers: 1,
      now: NOW + 4000,
    });
    expect(still.lastActivityAt).toBe(NOW + 2000);
  });

  it('converts gossip timestamps from microseconds and treats a newer one as activity', () => {
    const p = deriveSyncProgress({
      previous: undefined,
      metrics: metrics({
        peers: { a: { completed_rounds: 1, last_gossip_timestamp: (NOW - 1000) * 1000 } },
      }),
      knownPeers: 1,
      now: NOW,
    });
    expect(p.lastGossipAt).toBe(NOW - 1000);
    expect(p.lastActivityAt).toBe(NOW);
  });
});

describe('withKnownPeers', () => {
  it('derives from known peers alone before the first snapshot', () => {
    expect(withKnownPeers(undefined, 0, NOW).stage).toBe('no-peers');
    const p = withKnownPeers(undefined, 3, NOW);
    expect(p.stage).toBe('connecting');
    expect(p.peersFound).toBe(3);
  });

  it('leaves no-peers when agentInfo finds a peer between snapshots', () => {
    const snapshot = deriveSyncProgress({
      previous: undefined,
      metrics: metrics({}),
      knownPeers: 0,
      now: NOW,
    });
    const p = withKnownPeers(snapshot, 1, NOW + 1000);
    expect(p.stage).toBe('connecting');
    expect(p.peersFound).toBe(1);
  });

  it('keeps the snapshot stage and never lowers the peer count', () => {
    const snapshot = deriveSyncProgress({
      previous: undefined,
      metrics: metrics({ pending: 2, peers: { a: { completed_rounds: 1 }, b: {} } }),
      knownPeers: 2,
      now: NOW,
    });
    const p = withKnownPeers(snapshot, 1, NOW + 1000);
    expect(p.stage).toBe('syncing');
    expect(p.peersFound).toBe(2);
  });
});

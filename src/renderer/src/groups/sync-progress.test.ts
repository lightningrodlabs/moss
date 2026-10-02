import { describe, expect, it } from 'vitest';
import { deriveSyncProgress, elapsedSince, SyncProgress, withKnownPeers } from './sync-progress.js';
import type {
  NetworkMetricsWithCounts,
  PeerMetaWithCounts,
} from '../network/network-metrics-types.js';

function metrics(opts: {
  peers?: Record<string, PeerMetaWithCounts>;
  localOpCount?: number;
  pending?: number;
  roundsWith?: string[];
  initiatedWith?: string;
}): NetworkMetricsWithCounts {
  const pending_requests: Record<string, string[]> = {};
  for (let i = 0; i < (opts.pending ?? 0); i++) pending_requests[`op${i}`] = ['peer'];
  return {
    fetch_state_summary: { pending_requests } as NetworkMetricsWithCounts['fetch_state_summary'],
    gossip_state_summary: {
      initiated_round: opts.initiatedWith ? { session_with_peer: opts.initiatedWith } : undefined,
      accepted_rounds: (opts.roundsWith ?? []).map((url) => ({ session_with_peer: url })),
      dht_summary: {},
      peer_meta: opts.peers ?? {},
      local_op_count: opts.localOpCount,
    },
    local_agents: [],
  };
}

const NOW = 1_800_000_000_000;

function step(
  previous: SyncProgress | undefined,
  m: NetworkMetricsWithCounts | undefined,
  now: number,
  knownPeers = 1,
): SyncProgress {
  return deriveSyncProgress({ previous, metrics: m, knownPeers, now });
}

describe('deriveSyncProgress stages', () => {
  it('reports no peers when nothing is known', () => {
    expect(step(undefined, metrics({}), NOW, 0).stage).toBe('no-peers');
  });

  it('reports found when a peer is known but no contact happened this session', () => {
    const p = step(undefined, metrics({ peers: { a: {} } }), NOW);
    expect(p.stage).toBe('found');
    expect(p.peersFound).toBe(1);
    expect(p.peersConnected).toBe(0);
  });

  it('uses known peers before the first metrics snapshot', () => {
    const p = step(undefined, undefined, NOW, 2);
    expect(p.stage).toBe('found');
    expect(p.peersFound).toBe(2);
  });

  it('counts peers seen in gossip that agentInfo has not reported yet', () => {
    expect(step(undefined, metrics({ peers: { a: {}, b: {} } }), NOW).peersFound).toBe(2);
  });

  it('is connected while a sync session runs, counting that peer as connected', () => {
    const p = step(undefined, metrics({ peers: { a: {} }, roundsWith: ['a'] }), NOW);
    expect(p.stage).toBe('connected');
    expect(p.peersConnected).toBe(1);
    expect(p.activeRounds).toBe(1);
  });

  it('ignores gossip history from before this session', () => {
    // A restart keeps completed rounds and gossip times from the earlier session
    const p = step(
      undefined,
      metrics({
        peers: { a: { completed_rounds: 4, last_gossip_timestamp: (NOW - 60_000) * 1000 } },
      }),
      NOW,
    );
    expect(p.stage).toBe('found');
    expect(p.peersConnected).toBe(0);
  });

  it('is connected once a round completes during this session', () => {
    const first = step(undefined, metrics({ peers: { a: { completed_rounds: 4 } } }), NOW);
    const p = step(first, metrics({ peers: { a: { completed_rounds: 5 } } }), NOW + 2000);
    expect(p.stage).toBe('connected');
    expect(p.peersConnected).toBe(1);
  });

  it('is connected once the gossip time moves forward during this session', () => {
    const first = step(
      undefined,
      metrics({ peers: { a: { last_gossip_timestamp: (NOW - 60_000) * 1000 } } }),
      NOW,
    );
    const p = step(
      first,
      metrics({ peers: { a: { last_gossip_timestamp: (NOW + 1000) * 1000 } } }),
      NOW + 2000,
    );
    expect(p.stage).toBe('connected');
  });

  it('is unreachable when attempts this session fail and none succeed', () => {
    const first = step(undefined, metrics({ peers: { a: { peer_timeouts: 2 } } }), NOW);
    const p = step(first, metrics({ peers: { a: { peer_timeouts: 3 } } }), NOW + 2000);
    expect(p.stage).toBe('unreachable');
    expect(p.failedAttempts).toBe(1);
  });

  it('counts local and behavior errors as failed attempts', () => {
    const first = step(undefined, metrics({ peers: { a: {} } }), NOW);
    const p = step(
      first,
      metrics({ peers: { a: { local_errors: 1, peer_behavior_errors: 1 } } }),
      NOW + 2000,
    );
    expect(p.failedAttempts).toBe(2);
    expect(p.stage).toBe('unreachable');
  });

  it('goes back to connected when a round succeeds after a failure', () => {
    const first = step(undefined, metrics({ peers: { a: {} } }), NOW);
    const failed = step(first, metrics({ peers: { a: { peer_timeouts: 1 } } }), NOW + 2000);
    const p = step(
      failed,
      metrics({ peers: { a: { peer_timeouts: 1, completed_rounds: 1 } } }),
      NOW + 4000,
    );
    expect(p.stage).toBe('connected');
  });

  it('becomes unreachable when a failure follows an earlier success', () => {
    const first = step(undefined, metrics({ peers: { a: {} } }), NOW);
    const ok = step(first, metrics({ peers: { a: { completed_rounds: 1 } } }), NOW + 2000);
    const p = step(
      ok,
      metrics({ peers: { a: { completed_rounds: 1, peer_timeouts: 1 } } }),
      NOW + 4000,
    );
    expect(p.stage).toBe('unreachable');
  });

  it('does not count our own open attempt as contact', () => {
    // kitsune2 keeps an initiated round open for up to 15 s per attempt, even to a peer that is gone
    const p = step(undefined, metrics({ peers: { a: {} }, initiatedWith: 'a' }), NOW);
    expect(p.stage).toBe('found');
    expect(p.peersConnected).toBe(0);
    expect(p.activeRounds).toBe(0);
  });

  it('turns unreachable while retrying a peer that went away after contact', () => {
    const first = step(undefined, metrics({ peers: { a: {} } }), NOW);
    const ok = step(first, metrics({ peers: { a: { completed_rounds: 1 } } }), NOW + 2000);
    const p = step(
      ok,
      metrics({ peers: { a: { completed_rounds: 1, peer_timeouts: 1 } }, initiatedWith: 'a' }),
      NOW + 20_000,
    );
    expect(p.stage).toBe('unreachable');
  });

  it('ignores tombstoned peers', () => {
    const p = step(undefined, metrics({ peers: { a: { is_tombstone: true } } }), NOW, 0);
    expect(p.stage).toBe('no-peers');
  });
});

describe('deriveSyncProgress data', () => {
  it('counts data received since the first snapshot, not data held', () => {
    const first = step(undefined, metrics({ peers: { a: {} }, localOpCount: 7 }), NOW);
    expect(first.dataReceived).toBe(0);
    const p = step(first, metrics({ peers: { a: {} }, localOpCount: 19 }), NOW + 2000);
    expect(p.dataReceived).toBe(12);
  });

  it('reports no data count when the conductor omits it', () => {
    expect(step(undefined, metrics({ peers: { a: {} } }), NOW).dataReceived).toBeUndefined();
  });

  it('dates data arrival when the count grows or downloads are pending, not when a session opens', () => {
    const first = step(undefined, metrics({ peers: { a: {} }, localOpCount: 7 }), NOW);
    const session = step(
      first,
      metrics({ peers: { a: {} }, localOpCount: 7, roundsWith: ['a'] }),
      NOW + 2000,
    );
    expect(session.lastDataAt).toBeUndefined();
    const fetching = step(
      session,
      metrics({ peers: { a: {} }, localOpCount: 7, pending: 3 }),
      NOW + 4000,
    );
    expect(fetching.lastDataAt).toBe(NOW + 4000);
    const grew = step(fetching, metrics({ peers: { a: {} }, localOpCount: 10 }), NOW + 6000);
    expect(grew.lastDataAt).toBe(NOW + 6000);
    const still = step(grew, metrics({ peers: { a: {} }, localOpCount: 10 }), NOW + 8000);
    expect(still.lastDataAt).toBe(NOW + 6000);
  });

  it('converts gossip timestamps from microseconds', () => {
    const p = step(
      undefined,
      metrics({ peers: { a: { last_gossip_timestamp: (NOW - 9000) * 1000 } } }),
      NOW,
    );
    expect(p.lastGossipAt).toBe(NOW - 9000);
  });
});

describe('withKnownPeers', () => {
  it('derives from known peers alone before the first snapshot', () => {
    expect(withKnownPeers(undefined, 0, NOW).stage).toBe('no-peers');
    const p = withKnownPeers(undefined, 3, NOW);
    expect(p.stage).toBe('found');
    expect(p.peersFound).toBe(3);
  });

  it('leaves no-peers when agentInfo finds a peer between snapshots', () => {
    const snapshot = step(undefined, metrics({}), NOW, 0);
    const p = withKnownPeers(snapshot, 1, NOW + 1000);
    expect(p.stage).toBe('found');
    expect(p.peersFound).toBe(1);
  });

  it('keeps the snapshot stage and never lowers the peer count', () => {
    const snapshot = step(
      undefined,
      metrics({ peers: { a: {}, b: {} }, roundsWith: ['a'] }),
      NOW,
      2,
    );
    const p = withKnownPeers(snapshot, 1, NOW + 1000);
    expect(p.stage).toBe('connected');
    expect(p.peersFound).toBe(2);
  });
});

describe('elapsedSince', () => {
  it('uses seconds under a minute, never negative', () => {
    expect(elapsedSince(NOW - 43_400, NOW)).toEqual({ value: 43, unit: 'seconds' });
    expect(elapsedSince(NOW + 500, NOW)).toEqual({ value: 0, unit: 'seconds' });
  });

  it('uses whole minutes under an hour', () => {
    expect(elapsedSince(NOW - 60_000, NOW)).toEqual({ value: 1, unit: 'minutes' });
    expect(elapsedSince(NOW - 59 * 60_000 - 59_000, NOW)).toEqual({ value: 59, unit: 'minutes' });
  });

  it('uses whole hours from an hour on', () => {
    expect(elapsedSince(NOW - 3 * 3_600_000 - 1_000, NOW)).toEqual({ value: 3, unit: 'hours' });
  });
});

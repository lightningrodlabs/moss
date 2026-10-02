import type { NetworkMetricsWithCounts } from '../network/network-metrics-types.js';

/**
 * Where a group still waiting for its profile stands: nobody found yet,
 * peers found but no data moving, data moving, or caught up with peers
 * while the profile itself has not arrived.
 */
export type SyncStage = 'no-peers' | 'connecting' | 'syncing' | 'caught-up';

export interface SyncProgress {
  stage: SyncStage;
  peersFound: number;
  peersSyncedWith: number;
  localOpCount: number | undefined;
  highestPeerOpCount: number | undefined;
  pendingFetches: number;
  activeRounds: number;
  /** Most recent gossip with any peer, in ms since epoch. */
  lastGossipAt: number | undefined;
  /** Last time any sync data visibly moved, in ms since epoch. */
  lastActivityAt: number | undefined;
}

export function deriveSyncProgress(input: {
  previous: SyncProgress | undefined;
  metrics: NetworkMetricsWithCounts | undefined;
  knownPeers: number;
  now: number;
}): SyncProgress {
  const { previous, metrics, knownPeers, now } = input;
  const gossip = metrics?.gossip_state_summary;
  const livePeers = Object.values(gossip?.peer_meta ?? {}).filter((m) => !m.is_tombstone);

  const peersSyncedWith = livePeers.filter((m) => (m.completed_rounds ?? 0) > 0).length;
  const peerOpCounts = livePeers
    .map((m) => m.dht_op_count)
    .filter((c): c is number => typeof c === 'number');
  const highestPeerOpCount = peerOpCounts.length > 0 ? Math.max(...peerOpCounts) : undefined;
  const localOpCount = gossip?.local_op_count;
  const pendingFetches = Object.keys(metrics?.fetch_state_summary.pending_requests ?? {}).length;
  const activeRounds = (gossip?.initiated_round ? 1 : 0) + (gossip?.accepted_rounds.length ?? 0);
  const gossipTimes = livePeers
    .map((m) => m.last_gossip_timestamp)
    .filter((t): t is number => typeof t === 'number')
    .map((micros) => Math.floor(micros / 1000));
  const lastGossipAt = gossipTimes.length > 0 ? Math.max(...gossipTimes) : undefined;

  const peersFound = Math.max(knownPeers, livePeers.length);
  const behindPeers =
    localOpCount !== undefined &&
    highestPeerOpCount !== undefined &&
    highestPeerOpCount > localOpCount;

  let stage: SyncStage;
  if (peersFound === 0) stage = 'no-peers';
  else if (activeRounds > 0 || pendingFetches > 0 || behindPeers) stage = 'syncing';
  else if (peersSyncedWith > 0) stage = 'caught-up';
  else stage = 'connecting';

  const moved =
    activeRounds > 0 ||
    (localOpCount !== undefined && localOpCount > (previous?.localOpCount ?? localOpCount)) ||
    (previous !== undefined && pendingFetches !== previous.pendingFetches) ||
    (lastGossipAt !== undefined && lastGossipAt > (previous?.lastGossipAt ?? 0));

  return {
    stage,
    peersFound,
    peersSyncedWith,
    localOpCount,
    highestPeerOpCount,
    pendingFetches,
    activeRounds,
    lastGossipAt,
    lastActivityAt: moved ? now : previous?.lastActivityAt,
  };
}

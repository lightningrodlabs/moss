import type {
  NetworkMetricsWithCounts,
  PeerMetaWithCounts,
} from '../network/network-metrics-types.js';

/**
 * Where a group still waiting for its profile stands: nobody found yet,
 * peers found but no contact yet, peers found but every attempt this
 * session failed, or in contact with at least one peer.
 */
export type SyncStage = 'no-peers' | 'found' | 'unreachable' | 'connected';

/** Gossip counters per peer at the first snapshot, so history from before this session is ignored. */
interface PeerBaseline {
  rounds: number;
}

interface SessionBaseline {
  opCount: number | undefined;
  failures: number;
  peers: Record<string, PeerBaseline>;
}

export interface SyncProgress {
  stage: SyncStage;
  peersFound: number;
  /** Peers we had a sync session or a completed round with during this session. */
  peersConnected: number;
  /** Data items that arrived since the screen opened; undefined when the conductor does not report counts. */
  dataReceived: number | undefined;
  pendingFetches: number;
  activeRounds: number;
  /** Failed sync attempts during this session (timeouts and errors). */
  failedAttempts: number;
  /** Most recent gossip attempt with any peer, in ms since epoch, successful or not. */
  lastAttemptAt: number | undefined;
  /** Last time data visibly arrived during this session, in ms since epoch. */
  lastDataAt: number | undefined;
  /** Last time this session saw a successful round, in ms since epoch. */
  lastSuccessAt: number | undefined;
  /** Last time this session saw a failed attempt, in ms since epoch. */
  lastFailureAt: number | undefined;
  localOpCount: number | undefined;
  /** Running totals across live peers, compared between snapshots. */
  totalRounds: number;
  totalFailures: number;
  baseline: SessionBaseline | undefined;
}

const microsToMs = (micros: number | undefined) =>
  micros === undefined ? undefined : Math.floor(micros / 1000);

const failuresOf = (m: PeerMetaWithCounts) =>
  (m.peer_timeouts ?? 0) + (m.local_errors ?? 0) + (m.peer_behavior_errors ?? 0);

export function deriveSyncProgress(input: {
  previous: SyncProgress | undefined;
  metrics: NetworkMetricsWithCounts | undefined;
  knownPeers: number;
  now: number;
}): SyncProgress {
  const { previous, metrics, knownPeers, now } = input;
  const gossip = metrics?.gossip_state_summary;
  const livePeers = Object.entries(gossip?.peer_meta ?? {}).filter(([, m]) => !m.is_tombstone);
  const localOpCount = gossip?.local_op_count;
  const failures = livePeers.reduce((sum, [, m]) => sum + failuresOf(m), 0);

  const baseline: SessionBaseline | undefined =
    previous?.baseline ??
    (metrics
      ? {
          opCount: localOpCount,
          failures,
          peers: Object.fromEntries(
            livePeers.map(([url, m]) => [url, { rounds: m.completed_rounds ?? 0 }]),
          ),
        }
      : undefined);

  // Only rounds a peer opened with us prove contact. Our own initiated round is
  // just an attempt: kitsune2 keeps one open for up to 15 s, even to a peer that is gone.
  const roundPeers = new Set((gossip?.accepted_rounds ?? []).map((r) => r.session_with_peer));
  const contactedThisSession = (url: string, m: PeerMetaWithCounts) =>
    (m.completed_rounds ?? 0) > (baseline?.peers[url]?.rounds ?? 0);
  const peersConnected = livePeers.filter(
    ([url, m]) => roundPeers.has(url) || contactedThisSession(url, m),
  ).length;

  const totalRounds = livePeers.reduce((sum, [, m]) => sum + (m.completed_rounds ?? 0), 0);
  const gossipTimes = livePeers
    .map(([, m]) => microsToMs(m.last_gossip_timestamp))
    .filter((t): t is number => t !== undefined);
  // kitsune2 stamps this when it starts a round, before knowing whether the peer answers
  const lastAttemptAt = gossipTimes.length > 0 ? Math.max(...gossipTimes) : undefined;

  // Contact means a peer has a session open with us now, or a round completed
  // after the first snapshot; earlier completed rounds are history
  const succeeded =
    roundPeers.size > 0 || (previous !== undefined && totalRounds > previous.totalRounds);
  const failed = previous !== undefined && failures > previous.totalFailures;
  const lastSuccessAt = succeeded ? now : previous?.lastSuccessAt;
  const lastFailureAt = failed ? now : previous?.lastFailureAt;

  const pendingFetches = Object.keys(metrics?.fetch_state_summary.pending_requests ?? {}).length;
  const activeRounds = roundPeers.size;
  const dataGrew =
    previous !== undefined &&
    localOpCount !== undefined &&
    localOpCount > (previous.localOpCount ?? localOpCount);
  const lastDataAt = dataGrew || pendingFetches > 0 ? now : previous?.lastDataAt;

  const peersFound = Math.max(knownPeers, livePeers.length);
  const connected =
    activeRounds > 0 ||
    (lastSuccessAt !== undefined && lastSuccessAt >= (lastFailureAt ?? Number.NEGATIVE_INFINITY));

  let stage: SyncStage;
  if (peersFound === 0) stage = 'no-peers';
  else if (connected) stage = 'connected';
  else if (lastFailureAt !== undefined) stage = 'unreachable';
  else stage = 'found';

  return {
    stage,
    peersFound,
    peersConnected,
    dataReceived:
      localOpCount !== undefined && baseline?.opCount !== undefined
        ? Math.max(0, localOpCount - baseline.opCount)
        : undefined,
    pendingFetches,
    activeRounds,
    failedAttempts: baseline ? Math.max(0, failures - baseline.failures) : 0,
    lastAttemptAt,
    lastDataAt,
    lastSuccessAt,
    lastFailureAt,
    localOpCount,
    totalRounds,
    totalFailures: failures,
    baseline,
  };
}

/**
 * Combines the latest metrics snapshot with the current known-peer count.
 * agentInfo polling runs on its own schedule, so a peer it finds between
 * snapshots shows up right away instead of on the next metrics tick.
 */
export function withKnownPeers(
  snapshot: SyncProgress | undefined,
  knownPeers: number,
  now: number,
): SyncProgress {
  if (!snapshot) {
    return deriveSyncProgress({ previous: undefined, metrics: undefined, knownPeers, now });
  }
  const peersFound = Math.max(snapshot.peersFound, knownPeers);
  const stage = snapshot.stage === 'no-peers' && peersFound > 0 ? 'found' : snapshot.stage;
  return { ...snapshot, peersFound, stage };
}

/** A coarse elapsed time, in the largest unit that keeps the number readable. */
export interface Elapsed {
  value: number;
  unit: 'seconds' | 'minutes' | 'hours';
}

/** How long ago `then` was, relative to `now` (both ms since epoch). */
export function elapsedSince(then: number, now: number): Elapsed {
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return { value: seconds, unit: 'seconds' };
  if (seconds < 3600) return { value: Math.floor(seconds / 60), unit: 'minutes' };
  return { value: Math.floor(seconds / 3600), unit: 'hours' };
}

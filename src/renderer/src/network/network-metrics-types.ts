import type {
  DnaHashB64,
  FetchStateSummary,
  GossipStateSummary,
  LocalAgentSummary,
  PeerMeta,
  Timestamp,
} from '@holochain/client';

/**
 * Network metrics as the Holochain 0.7 conductor sends them. The op counts
 * and tombstone flag come from kitsune2 0.5 and are not declared in
 * @holochain/client 0.21, so they are optional here: an older conductor may
 * omit them.
 */
export interface PeerMetaWithCounts extends PeerMeta {
  last_gossip_timestamp?: Timestamp;
  dht_op_count?: number;
  is_tombstone?: boolean;
}

export interface GossipStateSummaryWithCounts extends GossipStateSummary {
  peer_meta: Record<string, PeerMetaWithCounts>;
  local_op_count?: number;
}

export interface NetworkMetricsWithCounts {
  fetch_state_summary: FetchStateSummary;
  gossip_state_summary: GossipStateSummaryWithCounts;
  local_agents: LocalAgentSummary[];
}

export type NetworkMetricsDump = Record<DnaHashB64, NetworkMetricsWithCounts>;

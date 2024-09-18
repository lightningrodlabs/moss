import { AgentPubKey, DnaHash } from '@holochain/client';
import { GroupProfile } from '@theweave/api';

export interface RelatedGroup {
  group_profile: GroupProfile;
  network_seed: string;
  group_dna_hash: DnaHash;
}

export type PeerStatusSignal =
  | {
      type: 'Ping';
      from_agent: AgentPubKey;
      status: string;
    }
  | {
      type: 'Pong';
      from_agent: AgentPubKey;
      status: string;
    };

export type PingPayload = {
  to_agents: AgentPubKey[];
  status: string;
  tz_utc_offset?: number;
};

export type PongPayload = {
  to_agent: AgentPubKey;
  status: string;
  tz_utc_offset?: number;
};

import { ZomeClient } from '@holochain-open-dev/utils';
import { AgentPubKey, AppClient, RoleName } from '@holochain/client';

import { SignalPayloadPeerStatus } from './types.js';

export class PeerStatusClient extends ZomeClient<SignalPayloadPeerStatus> {
  constructor(
    public client: AppClient,
    public roleName: RoleName,
    public zomeName = 'peer_status',
  ) {
    super(client, roleName, zomeName);
  }

  /**
   * Ping all specified agents, expecting for their pong later
   */
  async ping(agentPubKeys: AgentPubKey[], status, tzUtcOffset?: number): Promise<void> {
    return this.callZome('ping', {
      to_agents: agentPubKeys,
      status,
      tz_utc_offset: tzUtcOffset,
    });
  }

  /**
   * Pong all specified agents
   */
  async pong(agentPubKeys: AgentPubKey[], status, tzUtcOffset?: number): Promise<void> {
    return this.callZome('pong', {
      to_agents: agentPubKeys,
      status,
      tz_utc_offset: tzUtcOffset,
    });
  }
}

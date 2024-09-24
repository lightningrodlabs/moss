import { ActionHash, AgentPubKey, AgentPubKeyB64, DnaHash, EntryHash } from '@holochain/client';

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

export type StewardPermission = {
  /**
   * ActionHash of the StewardPermission based on which this permission has been issued
   */
  permission_hash?: ActionHash;
  for_agent: AgentPubKey;
  expiry?: number;
};

export type StewardPermissionClaim = {
  /**
   * Action hash of the steward permission
   */
  permission_hash: ActionHash;
  permission: StewardPermission;
};

export type PermissionType =
  | {
      type: 'Progenitor';
    }
  | {
      type: 'Steward';
      content: StewardPermissionClaim;
    }
  | {
      type: 'Member';
    };

export type GroupProfile = {
  /**
   * ActionHash of the StewardPermission based on which the profile has been created/edited
   */
  permission_hash?: ActionHash;
  name: string;
  icon_src: string;
  meta_data?: string;
};

export type GroupMetaData = {
  permission_hash?: ActionHash;
  name: string;
  data: string;
};

export type Applet = {
  /**
   * ActionHash of the StewardPermission based on which the Applet entry has been created
   */
  permission_hash?: ActionHash;
  /**
   * name of the applet instance as chosen by the person adding it to the group
   */
  custom_name: string;
  description: string;
  sha256_happ: string;
  sha256_ui: string | undefined;
  sha256_webhapp: string | undefined;
  distribution_info: string;
  network_seed: string | undefined;
  properties: Record<string, Uint8Array>; // Segmented by RoleId
  meta_data?: string;
};

export type PrivateAppletEntry = {
  public_entry_hash: EntryHash;
  applet: Applet;
  applet_pubkey: AgentPubKey;
};

export type JoinAppletInput = {
  applet: Applet;
  joining_pubkey: AgentPubKey;
};

export type AppletAgent = {
  group_pubkey: AgentPubKey;
  applet_pubkey: AgentPubKey;
};

export type GroupDnaProperties = {
  progenitor: AgentPubKeyB64 | null;
};

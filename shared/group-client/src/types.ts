import { ActionHash, AgentPubKey, AgentPubKeyB64, DnaHash, EntryHash } from '@holochain/client';
import { AppletId, WAL } from '@theweave/api';

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

export const GROUP_DESCRIPTION_NAME = 'description';
export const GROUP_APPLETS_META_DATA_NAME = 'APPLETS_META_DATA';

export type GroupMetaData = {
  permission_hash?: ActionHash;
  name: string;
  data: string;
};

/**
 * Metadata about Applets. For example to use as a means to indicate which Applets
 * should be joined by default by a new group member or to indicate which Applets
 * should be installed by an always-online node
 */
export type GroupAppletsMetaData = Record<AppletId, AppletMetaData>;

export type AppletMetaData = {
  tags: string[];
};

// These tags are used and depended upon in different places. Only change if you know what
// you're doing
export const ALWAYS_ONLINE_TAG = 'always-online';
export const DEFAULT_APPLET_TAG = 'default';

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

export type SignalPayload =
  | {
      type: 'Ping';
      from_agent: AgentPubKey;
      status: string;
      tz_utc_offset: number;
    }
  | {
      type: 'Pong';
      from_agent: AgentPubKey;
      status: string;
      tz_utc_offset: number;
    };

/**
 * Assets dna
 */

export type AssetRelation = {
  src_wal: WAL;
  dst_wal: WAL;
};

export type AssetRelationAndHash = {
  src_wal: WAL;
  dst_wal: WAL;
  relation_hash: EntryHash;
};

export type AssetRelationWithTags = {
  src_wal: WAL;
  dst_wal: WAL;
  tags: string[];
  relation_hash: EntryHash;
};

export type RelateAssetsInput = {
  src_wal: WAL;
  dst_wal: WAL;
  tags: string[];
};

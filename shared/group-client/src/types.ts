import {
  ActionHash,
  AgentPubKey,
  AgentPubKeyB64,
  DnaHash,
  Duration,
  EntryHash,
  Timestamp,
} from '@holochain/client';
import { AppletId, WAL } from '@theweave/api';

export interface RelatedGroup {
  group_profile: GroupProfile;
  network_seed: string;
  group_dna_hash: DnaHash;
}

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

export type Accountability =
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
export const GROUP_DASHBOARD_NAME = 'dashboard';

/**
 * A single tile placed on the group home dashboard. The discriminated union
 * lets stewards mix live WAL embeds with simple content blocks.
 */
export type DashboardTile =
  | {
      kind: 'wal-embed';
      wal: string;
      /**
       * Base64-encoded EntryHash of the applet that owns the WAL's asset, captured
       * at tile-creation time. Lets the embed render a "Tool not activated" message
       * with a working Activate button when the local agent has not yet joined the
       * owning applet — otherwise the bare WAL lookup fails and the tile shows a
       * generic "Asset not found" string. Optional for backwards compatibility with
       * tiles created before this field existed.
       */
      srcAppletHash?: string;
      /**
       * Base64-encoded DnaHash of the group whose registry holds the source applet.
       * Combined with `srcAppletHash`, identifies the exact activate target for the
       * embed's Activate button. Optional for backwards compatibility.
       */
      srcGroupDnaHash?: string;
    }
  | { kind: 'markdown'; source: string }
  | { kind: 'image'; src: string; alt?: string }
  | { kind: 'iframe'; src: string };

/**
 * Layout coordinates use Gridstack's 12-column grid model (`w`/`h` are in
 * grid units, not pixels). `id` is a stable client-side identifier so the
 * grid can re-associate tiles with DOM nodes across renders.
 *
 * `fixed` (default false) marks a tile as a pinned-size element: when true
 * the tile cannot be moved or resized in edit mode and other tiles flow
 * around it. Use for "anchor" content (a logo, a fixed-aspect image) where
 * resizing changes meaning.
 */
export type DashboardTileEntry = {
  id: string;
  layout: { x: number; y: number; w: number; h: number };
  tile: DashboardTile;
  fixed?: boolean;
  /**
   * Optional accent background for the tile. When unset, the tile uses the
   * default (white) background. Otherwise stored as a stable key (e.g.
   * 'green', 'blue') that the renderer maps to a CSS color so the palette
   * can evolve without re-encoding existing entries.
   */
  color?: string;
  /**
   * When true the tile grows to fill the visible vertical space of the
   * dashboard. Only meaningful for a tile with no other tiles below it in its
   * column span (otherwise growing would push them down indefinitely). The
   * renderer recomputes `layout.h` from the available height and re-applies on
   * resize, since a gridstack grid has no native "fill remaining height".
   */
  fillHeight?: boolean;
};

/**
 * Current on-chain shape version for {@link GroupDashboard}. Bump whenever the
 * persisted tile/dashboard shape changes in a non-additive way, and migrate in
 * {@link GroupClient.getGroupDashboard}. Entries written before versioning was
 * introduced have no `schemaVersion` and are treated as version 1.
 */
export const GROUP_DASHBOARD_SCHEMA_VERSION = 2;

export type GroupDashboard = {
  /**
   * Shape version of this dashboard entry. Absent on entries written before
   * versioning existed — readers treat `undefined` as version 1.
   */
  schemaVersion?: number;
  tiles: DashboardTileEntry[];
  updatedAt: number;
  /**
   * Whether the group's foyer (chat) panel is shown. Optional per group.
   * `undefined` is treated as enabled so existing groups keep their foyer.
   */
  foyerEnabled?: boolean;
};

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
  subtitle: string;
  sha256_happ: string;
  sha256_ui: string | undefined;
  sha256_webhapp: string | undefined;
  distribution_info: string;
  network_seed: string | undefined;
  properties: Record<string, Uint8Array>; // Segmented by RoleId
  meta_data?: string;
};

export type AppletEntryPrivate = {
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

export type SignalPayloadGroup = {
  type: 'Arbitrary';
  /**
   * Arbitrary string content but should be parseable to type GroupRemoteSignal
   */
  content: Uint8Array;
};

export type SignalPayloadPeerStatus =
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

export type SignalPayloadAssets =
  | {
      type: 'AssetTagsAdded';
      wal: WAL;
      tags: string[];
    }
  | {
      type: 'AssetTagsRemoved';
      wal: WAL;
      tags: string[];
    }
  | {
      type: 'AssetRelationCreated';
      relation: AssetRelationWithTags;
    }
  | {
      type: 'AssetRelationRemoved';
      relation: AssetRelationAndHash;
    }
  | {
      type: 'RelationTagsAdded';
      relation_hash: EntryHash;
      src_wal: WAL;
      dst_wal: WAL;
      tags: string[];
    }
  | {
      type: 'RelationTagsRemoved';
      relation_hash: EntryHash;
      src_wal: WAL;
      dst_wal: WAL;
      tags: string[];
    };

export type AssetRelation = {
  src_wal: WAL;
  dst_wal: WAL;
};

export type AssetRelationAndHash = {
  src_wal: WAL;
  dst_wal: WAL;
  relation_hash: EntryHash;
  created_at: number;
};

export type AssetRelationWithTags = {
  src_wal: WAL;
  dst_wal: WAL;
  tags: string[];
  relation_hash: EntryHash;
  created_at: number;
};

export type RelateAssetsInput = {
  src_wal: WAL;
  dst_wal: WAL;
  tags: string[];
};

export type AppletClonedCell = {
  applet_hash: EntryHash;
  dna_hash: DnaHash;
  role_name: string;
  network_seed?: string;
  /**
   * Any yaml serializable properties
   */
  properties?: unknown;
};

export type TagsToAssetInput = {
  wal: WAL;
  tags: string[];
};

export type RemoveTagsFromAssetRelationInput = {
  relation_hash: EntryHash;
  tags: string[];
};

export type RelationsForWal = {
  wal: WAL;
  tags: string[];
  linked_to: AssetRelationWithTags[];
  linked_from: AssetRelationWithTags[];
};

export type GroupRemoteSignal =
  | {
      type: 'assets-signal';
      content: SignalPayloadAssets;
    }
  | {
      type: 'applet-signal';
      appletId: AppletId;
      payload: Uint8Array;
    };

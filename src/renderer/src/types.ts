import {
  ActionHash,
  ActionHashB64,
  AgentPubKey,
  AgentPubKeyB64,
  DnaHash,
  DnaHashB64,
  EntryHash,
  EntryHashB64,
  FullStateDump,
} from '@holochain/client';
import { FrameNotification } from '@lightningrodlabs/we-applet';

/**
 * EntryHashB64 of the Applet entry in the group's We DHT.
 */
export type AppletId = string;

/**
 * EntryHash of the Applet entry in the group's We DHT.
 */
export type AppletHash = EntryHash;

/**
 * DnaHash of a We group
 */
export type GroupDnaHash = DnaHash;

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

export type WebHappSource = {
  type: 'https';
  url: string;
};

export type AppHashes =
  | {
      type: 'webhapp';
      sha256: string;
      happ: {
        sha256: string;
      };
      ui: {
        sha256: string;
      };
    }
  | {
      type: 'happ';
      sha256: string;
    };

export type DistributionInfo =
  | {
      type: 'tools-library';
      info: {
        toolsLibraryDnaHash: DnaHashB64;
        /**
         * Action Hash B64 of the original Tool entry
         */
        originalToolActionHash: ActionHashB64;
        /**
         * ActionHashB64 of the (updated) Tool entry this applet has been installed from
         */
        toolVersionActionHash: ActionHashB64;
        toolVersionEntryHash: EntryHashB64;
      };
    }
  | {
      type: 'filesystem'; // Installed from filesystem
    };

export type AppAssetsInfo =
  | {
      type: 'happ';
      assetSource: AssetSource; // Source of the actual asset bytes
      distributionInfo: DistributionInfo; // Info about the distribution channel (e.g. appstore hashes)
      sha256: string; // sha256 hash of the .happ file
    }
  | {
      type: 'webhapp';
      assetSource: AssetSource;
      distributionInfo: DistributionInfo; // Info about the distribution channel (e.g. appstore hashes)
      sha256?: string; // sha256 hash of the .webhapp file
      happ: {
        sha256: string; // sha256 hash of the .happ file. Will also define the name of the .happ file
        dnas?: any; // sha256 hashes of dnas and zomes
      };
      ui: {
        location:
          | {
              type: 'filesystem';
              sha256: string; // Also defines the foldername where the unzipped assets are stored
            }
          | {
              type: 'localhost';
              port: number;
            };
      };
    };

export type AssetSource =
  | {
      type: 'https';
      url: string;
    }
  | {
      type: 'filesystem'; // Installed from filesystem
    }
  | {
      type: 'default-app'; // Shipped with the We executable by default
    };

export type AppletNotification = {
  appletId: AppletId;
  notification: FrameNotification;
};

export type MessageContentPart =
  | {
      type: 'text';
      content: string;
    }
  | {
      type: 'agent';
      pubkey: AgentPubKeyB64;
    };

/**
 * Notification feed to end-users
 */
export type UpdateFeed = {
  [key: string]: Array<UpdateFeedMessage>;
};

export type UpdateFeedMessage = {
  type: string;
  timestamp: number;
  message: string;
};

export type DumpData = {
  dump: FullStateDump;
  newOpsCount: number;
};

export type GroupDnaProperties = {
  progenitor: AgentPubKeyB64 | null;
};

export type PartialModifiers = {
  networkSeed: string;
  progenitor: AgentPubKeyB64 | null;
};

export type ToolWeaveConfig = {
  crossGroupView: boolean;
};

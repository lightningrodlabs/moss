import {
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

export type Applet = {
  custom_name: string; // name of the applet instance as chosen by the person adding it to the group,
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

export type RegisterAppletInput = {
  applet: Applet;
  joining_pubkey: AgentPubKey;
};

export type AppletAgent = {
  group_pubkey: AgentPubKey;
  applet_pubkey: AgentPubKey;
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
      type: 'appstore-light';
      info: {
        appstoreDnaHash: DnaHashB64;
        // according to https://docs.rs/hc_crud_caps/0.10.3/hc_crud/struct.Entity.html
        appEntryId: ActionHashB64;
        appEntryActionHash: ActionHashB64;
        appEntryEntryHash: EntryHashB64;
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

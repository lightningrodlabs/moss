import { ProfilesClient } from '@holochain-open-dev/profiles';
import { Readable } from '@holochain-open-dev/stores';
import {
  AppClient,
  ActionHash,
  EntryHash,
  DnaHash,
  EntryHashB64,
  ActionHashB64,
  DnaHashB64,
  CallZomeRequest,
  AppAuthenticationToken,
  AgentPubKeyB64,
  AgentPubKey,
} from '@holochain/client';

export type AppletHash = EntryHash;
export type AppletId = EntryHashB64;

/**
 * Hash of Holohash lenght but all zeroes
 */
export type NullHash = Uint8Array;

export type Hrl = [DnaHash, ActionHash | EntryHash];
export type HrlB64 = [DnaHashB64, ActionHashB64 | EntryHashB64];

export type OpenWalMode = 'front' | 'side' | 'window';

/**
 * String of the format weave-0.13://
 */
export type WeaveUrl = string;

export type WeaveLocation =
  | {
      type: 'group';
      dnaHash: DnaHash;
    }
  | {
      type: 'applet';
      appletHash: AppletHash;
    }
  | {
      type: 'asset';
      wal: WAL;
    }
  | {
      type: 'invitation';
      // network seed and membrane proofs
      secret: string;
    };

// Weave Asset Locator - an HRL with context
// Use case: Image we want to point to a specific section of a document
// The document action hash would be the Hrl, and the context could be { section: "Second Paragraph" }
export type WAL = {
  hrl: Hrl;
  context?: any;
};

export type AssetInfo = {
  name: string;
  icon_src: string;
};

export type GroupProfile = {
  name: string;
  icon_src: string;
  meta_data?: string;
};

export type FrameNotification = {
  /**
   * Title of the message.
   */
  title: string;
  /**
   * content of the notification
   */
  body: string;
  /**
   * type of notification, in a chat app e.g. "message" or "mention"
   */
  notification_type: string;
  /**
   * Icon for the message type.
   */
  icon_src: string | undefined;
  /**
   * urgency level "low" only shows up in Activity Feed(s)
   * urgency level "medium" shows up as a dot in the system tray icon
   * urgency level "high" additionally triggers an OS notification
   */
  urgency: 'low' | 'medium' | 'high';
  /**
   * Timestamp **in milliseconds** of when the event that the notification is about
   * has occured.
   * Ideally the timestamp of the DHT Action associated to the notification.
   * It may be displayed by Moss in notification feeds and will be used to determine
   * whether an event is "fresh" or has occurred while the user was offline.
   * In the latter case, Moss will not show an OS notification for
   * that notification on startup of Moss.
   */
  timestamp: number;

  aboutWal?: WAL;

  fromAgent?: AgentPubKey;

  forAgents?: AgentPubKey[];

  // /**
  //  * If not provided, Moss resets the notification count (used for
  //  * dots on applet icons and similar) for this message automatically when
  //  * the user opens the applet (default). Otherwise, the applet is assumed
  //  * to take care of clearing the notification count for this message via
  //  * use of resetNotificationCount() and based on applet-internal logic.
  //  * If handled improperly by the applet, this can lead to accumulation
  //  * of notifications and Moss will delete stale notifications after
  //  * a certain time period.
  //  */
  // customCountReset?: NotificationId;
};

export type NotificationId = string;

export type NotificationCount = {
  low: number;
  medium: number;
  high: number;
};

export interface OpenViews {
  openAppletMain(appletHash: EntryHash): void;
  openAppletBlock(appletHash: EntryHash, block: string, context: any): void;
  openWal(wal: WAL): void;
  openCrossAppletMain(appletBundleId: ActionHash): void;
  openCrossAppletBlock(appletBundleId: ActionHash, block: string, context: any): void;
}

export type AssetLocationAndInfo = {
  appletHash: AppletHash;
  assetInfo: AssetInfo;
  /**
   * Only set if Moss is run in applet development mode and the applet is running in hot-reloading mode
   */
  appletDevPort?: number;
};

export type AppletInfo = {
  appletBundleId: ActionHash;
  appletName: string;
  appletIcon: string;
  groupsHashes: Array<DnaHash>;
};

export type AppletClients = {
  appletClient: AppClient;
  profilesClient: ProfilesClient;
};

export type AppletView =
  | { type: 'main' }
  | { type: 'block'; block: string; context: any }
  | {
      type: 'asset';
      /**
       * If the WAL points to a Record (AnyDhtHash) recordInfo will be defined, if the WAL
       * points to a DNA (i.e. null hash for the AnyDhtHash) then recordInfo is not defined
       */
      recordInfo?: RecordInfo;
      wal: WAL;
    }
  | {
      type: 'creatable';
      name: CreatableName;
      /**
       * To be called after the creatable has been successfully created. Will close the creatable view.
       * @param wal
       * @returns
       */
      resolve: (wal: WAL) => Promise<void>;
      /**
       * To be called if creation fails due to an error
       * @param reason
       * @returns
       */
      reject: (reason: any) => Promise<void>;
      /**
       * To be called if user cancels the creation
       */
      cancel: () => Promise<void>;
    };

export type CrossAppletView =
  | {
      type: 'main';
    }
  | {
      type: 'block';
      block: string;
      context: any;
    };

export type CreatableType = {
  /**
   * The label for the creatable that's displayed in Moss to open the creatable view
   */
  label: string;
  icon_src: string;
  width?: 'small' | 'medium' | 'large';
  height?: 'small' | 'medium' | 'large';
};

/**
 * The name that's being used in RenderInfo to tell which creatable should be rendered
 */
export type CreatableName = string;

export type CreatableResult =
  | {
      type: 'success';
      wal: WAL;
    }
  | {
      type: 'cancel';
    }
  | {
      type: 'error';
      reason: any;
    };

export type BlockType = {
  label: string;
  icon_src: string;
  view: 'applet-view' | 'cross-applet-view';
};

export type BlockName = string;

export type RenderInfo =
  | {
      type: 'applet-view';
      view: AppletView;
      appletClient: AppClient;
      profilesClient: ProfilesClient;
      peerStatusStore: ReadonlyPeerStatusStore;
      appletHash: AppletHash;
      /**
       * Non-exhaustive array of profiles of the groups the given applet is shared with.
       * Note that an applet may be shared with other groups beyond the ones returned
       * by this array if the applet has been federated with groups that the agent
       * of the given Moss instance is not part of.
       */
      groupProfiles: GroupProfile[];
    }
  | {
      type: 'cross-applet-view';
      view: CrossAppletView;
      applets: ReadonlyMap<EntryHash, AppletClients>;
    };

export type RenderView =
  | {
      type: 'applet-view';
      view: AppletView;
    }
  | {
      type: 'cross-applet-view';
      view: CrossAppletView;
    };

export type ParentToAppletMessage =
  | {
      type: 'get-applet-asset-info';
      wal: WAL;
      recordInfo?: RecordInfo;
    }
  | {
      type: 'get-block-types';
    }
  | {
      type: 'bind-asset';
      srcWal: WAL;
      dstWal: WAL;
      dstRecordInfo?: RecordInfo;
    }
  | {
      type: 'search';
      filter: string;
    }
  | {
      type: 'peer-status-update';
      payload: PeerStatusUpdate;
    }
  | {
      type: 'on-before-unload';
    };

export type AppletToParentMessage = {
  request: AppletToParentRequest;
  appletHash?: AppletHash; // Only required in dev mode when iframe origin is localhost
};

export type AppletToParentRequest =
  | {
      type: 'ready';
    }
  | {
      type: 'get-iframe-config';
      crossApplet: boolean;
    }
  | {
      type: 'get-record-info';
      hrl: Hrl;
    }
  | {
      type: 'sign-zome-call';
      request: CallZomeRequest;
    }
  | {
      type: 'open-view';
      request: OpenViewRequest;
    }
  | {
      type: 'search';
      filter: string;
    }
  | {
      type: 'notify-frame';
      notifications: Array<FrameNotification>;
    }
  | {
      type: 'get-applet-info';
      appletHash: AppletHash;
    }
  | {
      type: 'get-group-profile';
      groupHash: DnaHash;
    }
  | {
      type: 'get-global-asset-info';
      wal: WAL;
    }
  | {
      type: 'wal-to-pocket';
      wal: WAL;
    }
  | {
      type: 'drag-wal';
      wal: WAL;
    }
  | {
      type: 'request-bind';
      srcWal: WAL;
      dstWal: WAL;
    }
  | {
      type: 'my-group-permission-type';
    }
  | {
      type: 'applet-participants';
    }
  | {
      type: 'user-select-wal';
    }
  | {
      type: 'user-select-screen';
    }
  | {
      type: 'toggle-pocket';
    }
  | {
      type: 'update-creatable-types';
      value: Record<CreatableName, CreatableType>;
    }
  | {
      type: 'creatable-result';
      result: CreatableResult;
      /**
       * The id of the dialog this result is coming from
       */
      dialogId: string;
    }
  | {
      type: 'localStorage.setItem';
      key: string;
      value: string;
    }
  | {
      type: 'localStorage.removeItem';
      key: string;
    }
  | {
      type: 'localStorage.clear';
    }
  | {
      type: 'get-localStorage';
    }
  | {
      type: 'get-applet-iframe-script';
    }
  | {
      type: 'request-close';
    };

export type OpenViewRequest =
  | {
      type: 'applet-main';
      appletHash: EntryHash;
    }
  | {
      type: 'cross-applet-main';
      appletBundleId: ActionHash;
    }
  | {
      type: 'applet-block';
      appletHash: EntryHash;
      block: string;
      context: any;
    }
  | {
      type: 'cross-applet-block';
      appletBundleId: ActionHash;
      block: string;
      context: any;
    }
  | {
      type: 'wal';
      wal: WAL;
      mode?: OpenWalMode;
    };

export type IframeConfig =
  | {
      type: 'applet';
      appPort: number;
      appletHash: EntryHash;
      authenticationToken: AppAuthenticationToken;
      weaveProtocolVersion: string;
      mossVersion: string;
      profilesLocation: ProfilesLocation;
      groupProfiles: GroupProfile[];
    }
  | {
      type: 'cross-applet';
      appPort: number;
      weaveProtocolVersion: string;
      mossVersion: string;
      applets: Record<EntryHashB64, [AppAuthenticationToken, ProfilesLocation]>;
    }
  | {
      type: 'not-installed';
      appletName: string;
    };

export type ProfilesLocation = {
  authenticationToken: AppAuthenticationToken;
  profilesRoleName: string;
};

export type RecordInfo = {
  roleName: string;
  integrityZomeName: string;
  entryType: string;
};

/**
 *
 * Events
 *
 */

export type UnsubscribeFunction = () => void;

export type PeerStatus = {
  lastSeen: number;
  status: string;
  /**
   * Timezone offset from UTC, in minutes
   */
  tzUtcOffset?: number;
};

export type PeerStatusUpdate = Record<AgentPubKeyB64, PeerStatus>;

export type ReadonlyPeerStatusStore = Readable<Record<AgentPubKeyB64, PeerStatus>>;

export type GroupPermissionType =
  | {
      type: 'Steward';
      /**
       * Expiry date in ms since Unix epoch time
       */
      expiry?: number;
    }
  | {
      type: 'Member';
    }
  | {
      /**
       * Can only occur if the applet belongs to more than one group
       */
      type: 'Ambiguous';
    };

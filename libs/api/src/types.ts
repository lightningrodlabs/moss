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
  CreateCloneCellRequest,
  DisableCloneCellRequest,
  EnableCloneCellRequest,
  InstalledAppId,
} from '@holochain/client';

export type AppletHash = EntryHash;
export type AppletId = EntryHashB64;

/**
 * Hash of Holohash lenght but all zeroes
 */
export type NullHash = Uint8Array;

export type Hrl = [DnaHash, ActionHash | EntryHash];
export type HrlB64 = [DnaHashB64, ActionHashB64 | EntryHashB64];

export type OpenAssetMode = 'front' | 'side' | 'window';

/**
 * String of the format weave-0.15://
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
  openCrossGroupMain(appletBundleId: string): void;
  openCrossGroupBlock(appletBundleId: string, block: string, context: any): void;
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
  appletBundleId: string;
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
       * @param error
       * @returns
       */
      reject: (error: any) => Promise<void>;
      /**
       * To be called if user cancels the creation
       */
      cancel: () => Promise<void>;
    };

export type CrossGroupView =
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
      error: any;
    };

export type BlockType = {
  label: string;
  icon_src: string;
  view: 'applet-view' | 'cross-group-view';
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
      type: 'cross-group-view';
      view: CrossGroupView;
      applets: ReadonlyMap<EntryHash, AppletClients>;
    };

export type RenderView =
  | {
      type: 'applet-view';
      view: AppletView;
    }
  | {
      type: 'cross-group-view';
      view: CrossGroupView;
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
      type: 'search';
      filter: string;
    }
  | {
      type: 'peer-status-update';
      payload: PeerStatusUpdate;
    }
  | {
      type: 'on-before-unload';
    }
  | {
      type: 'asset-store-update';
      /**
       * We can save ourselves one unnecessary stringification step
       * by sending it as stringified
       */
      walStringified: string;
      value: AsyncStatus<AssetStoreContent>;
    }
  | {
      type: 'remote-signal-received';
      payload: Uint8Array;
    };

export type IframeKind =
  | {
      type: 'applet';
      appletHash: AppletHash; // Only required in dev mode when iframe origin is localhost
      subType: string;
    }
  | {
      type: 'cross-group';
      toolCompatibilityId: string; // Only required in dev mode when iframe origin is localhost
      subType: string;
    };

export type AppletToParentMessage = {
  request: AppletToParentRequest;
  source: IframeKind;
};

export type ZomeCallLogInfo = {
  fnName: string;
  installedAppId: InstalledAppId;
  durationMs: number;
};

export type AppletToParentRequest =
  | {
      type: 'ready';
    }
  | {
      // This one is used by initializeHotReload() and is the only one that
      // affects the API exposed to tool devs
      //
      // It's also used as a means to register the iframe in order for Moss
      // to be able to send messages to it
      type: 'get-iframe-config';
      id: string;
      subType: 'main' | 'asset' | 'block' | 'creatable';
    }
  | {
      type: 'unregister-iframe';
      id: string;
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
      type: 'log-zome-call';
      info: ZomeCallLogInfo;
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
    type: 'get-tool-installer';
    appletHash: AppletHash;
    groupHash: DnaHash;
  }
  | {
      type: 'get-group-profile';
      groupHash: DnaHash;
    }
  | {
      type: 'my-accountabilities-per-group';
    }
  | {
      type: 'applet-participants';
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
      type: 'get-applet-iframe-script';
    }
  | {
      type: 'request-close';
    }
  | {
      type: 'send-remote-signal';
      payload: Uint8Array;
      toAgents?: AgentPubKey[];
    }
  | {
      type: 'create-clone-cell';
      req: CreateCloneCellRequest;
      publicToGroupMembers: boolean;
    }
  | {
      type: 'disable-clone-cell';
      req: DisableCloneCellRequest;
    }
  | {
      type: 'enable-clone-cell';
      req: EnableCloneCellRequest;
    }
  /**
   * Asset related requests
   */
  | {
      type: 'asset-to-pocket';
      wal: WAL;
    }
  | {
      type: 'user-select-asset';
      from?: 'search' | 'pocket' | 'create';
    }
  | {
      type: 'user-select-asset-relation-tag';
    }
  | {
      type: 'get-global-asset-info';
      wal: WAL;
    }
  | {
      type: 'drag-asset';
      wal: WAL;
    }
  | {
      type: 'add-tags-to-asset';
      wal: WAL;
      tags: string[];
    }
  | {
      type: 'remove-tags-from-asset';
      wal: WAL;
      tags: string[];
    }
  | {
      type: 'add-asset-relation';
      srcWal: WAL;
      dstWal: WAL;
      tags?: string[];
    }
  | {
      type: 'remove-asset-relation';
      relationHash: EntryHash;
    }
  | {
      type: 'add-tags-to-asset-relation';
      relationHash: EntryHash;
      tags: string[];
    }
  | {
      type: 'remove-tags-from-asset-relation';
      relationHash: EntryHash;
      tags: string[];
    }
  | {
      type: 'get-all-asset-relation-tags';
      crossGroup?: boolean;
    }
  | {
      type: 'subscribe-to-asset-store';
      wal: WAL;
    }
  | {
      type: 'unsubscribe-from-asset-store';
      wal: WAL;
    };

export type OpenViewRequest =
  | {
      type: 'applet-main';
      appletHash: EntryHash;
    }
  | {
      type: 'cross-group-main';
      appletBundleId: string;
    }
  | {
      type: 'applet-block';
      appletHash: EntryHash;
      block: string;
      context: any;
    }
  | {
      type: 'cross-group-block';
      appletBundleId: string;
      block: string;
      context: any;
    }
  | {
      type: 'asset';
      wal: WAL;
      mode?: OpenAssetMode;
    };

export type IframeConfig =
  | {
      type: 'applet';
      appPort: number;
      /**
       * The origin of the main Moss UI. Used to validate iframe message origins.
       */
      mainUiOrigin: string;
      appletHash: EntryHash;
      authenticationToken: AppAuthenticationToken;
      weaveProtocolVersion: string;
      mossVersion: string;
      profilesLocation: ProfilesLocation;
      groupProfiles: GroupProfile[];
      zomeCallLogging: boolean;
    }
  | {
      type: 'cross-group';
      appPort: number;
      /**
       * The origin of the main Moss UI. Used to validate iframe message origins.
       */
      mainUiOrigin: string;
      weaveProtocolVersion: string;
      mossVersion: string;
      applets: Record<EntryHashB64, [AppAuthenticationToken, ProfilesLocation]>;
      zomeCallLogging: boolean;
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

/**
 * An accountability is when an agent holds a role in a specific time period.
 * A role is a set of privileges and has a fixed term/mandate duration.
 * A privilege lets an agent perform a certain action.
 */

/** */
export enum MossPrivilege {
  ArchiveTool,
  AddTool,
  MakeSteward,
  ChangeGroupProperties,
}

export type GroupRole = {
  name: string,
  defaultMandateDuration: number; // in ms since Unix epoch time ; 0 == forever
  privileges: MossPrivilege[];
}

/** MossRole is a typed Enum of GroupRoles */
export const MossRole = {
  Member: { name: 'Member', mandateDuration: 0, privileges: [] },
  Steward: { name: 'Steward', mandateDuration: 0, privileges: [MossPrivilege.AddTool, MossPrivilege.ChangeGroupProperties, MossPrivilege.MakeSteward] },
  Progenitor: { name: 'Progenitor', mandateDuration: 0, privileges: [MossPrivilege.AddTool, MossPrivilege.ChangeGroupProperties, MossPrivilege.ArchiveTool, MossPrivilege.MakeSteward]},
} as const;
export type MossRole = typeof MossRole[keyof typeof MossRole];

export type MossAccountability = {
  role: MossRole,
  startDate: number, // in ms since Unix epoch time
  duration?: number, // use role's defaultMandateDuration if not specified
  // expiry() // = startDate + mandateDuration
}

export type WalRelationAndTags = {
  relationHash: EntryHash;
  /**
   * Timestamp of when the asset relation to this WAL has been created
   */
  createdAt: number;
  wal: WAL;
  tags: string[];
};

export type AssetStoreContent = {
  linkedTo: WalRelationAndTags[];
  linkedFrom: WalRelationAndTags[];
  tags: string[];
};

export type AsyncStatus<T> =
  | {
      status: 'pending';
    }
  | {
      status: 'complete';
      value: T;
    }
  | {
      status: 'error';
      error: any;
    };

export type AssetStore = Readable<AsyncStatus<AssetStoreContent>>;

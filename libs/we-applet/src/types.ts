import { ProfilesClient } from "@holochain-open-dev/profiles";
import {
  AppAgentClient,
  ActionHash,
  EntryHash,
  DnaHash,
  EntryHashB64,
  ActionHashB64,
  DnaHashB64,
  CallZomeRequest,
} from "@holochain/client";


export type AppletHash = EntryHash;
export type AppletId = EntryHashB64;

export type Hrl = [DnaHash, ActionHash | EntryHash];
export type HrlB64 = [DnaHashB64, ActionHashB64 | EntryHashB64];


// Contextual reference to a Hrl
// Useful use case: image we want to point to a specific section of a document
// The document action hash would be the Hrl, and the context could be { section: "Second Paragraph" }
export interface HrlWithContext {
  hrl: Hrl;
  context: any;
}

export interface HrlB64WithContext {
  hrl: HrlB64;
  context: any;
}

export interface EntryInfo {
  name: string;
  icon_src: string;
}

export interface GroupProfile {
  name: string;
  logo_src: string;
}

export interface AttachmentType {
  label: string;
  icon_src: string;
  create: (attachToHrl: Hrl) => Promise<HrlWithContext>;
}

export type AttachmentName = string;

export interface WeNotification {
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
   * urgency level "low" only shows up in the We UI when opened
   * urgency level "medium" shows up as a dot in the system tray icon
   * urgency level "high" additionally triggers an OS notification
   */
  urgency: "low" | "medium" | "high";
  /**
   * Timestamp **in milliseconds** of when the event that the notification is about
   * has occured.
   * Ideally the timestamp of the DHT Action associated to the notification.
   * It may be displayed by We in notification feeds and will be used to determine
   * whether an event is "fresh" or has occurred while the user was offline.
   * In the latter case, We will not show an OS notification for
   * that notification on startup of We.
   */
  timestamp: number;
  // /**
  //  * If not provided, We resets the notification count (used for
  //  * dots on applet icons and similar) for this message automatically when
  //  * the user opens the applet (default). Otherwise, the applet is assumed
  //  * to take care of clearing the notification count for this message via
  //  * use of resetNotificationCount() and based on applet-internal logic.
  //  * If handled improperly by the applet, this can lead to accumulation
  //  * of notifications and We will delete stale notifications after
  //  * a certain time period.
  //  */
  // customCountReset?: NotificationId;
}

export type NotificationId = string;

export interface NotificationCount {
  low: number,
  medium: number,
  high: number,
}

export interface OpenViews {
  openAppletMain(appletHash: EntryHash): void;
  openAppletBlock(appletHash: EntryHash, block: string, context: any): void;
  openHrl(hrl: Hrl, context: any): void;
  openCrossAppletMain(appletBundleId: ActionHash): void;
  openCrossAppletBlock(
    appletBundleId: ActionHash,
    block: string,
    context: any
  ): void;
}

export interface EntryLocationAndInfo {
  appletHash: EntryHash;
  entryInfo: EntryInfo;
}

export interface AppletInfo {
  appletBundleId: ActionHash;
  appletName: string;
  groupsIds: Array<DnaHash>;
}

export interface AppletClients {
  appletClient: AppAgentClient;
  profilesClient: ProfilesClient;
}

export type AppletView =
  | { type: "main" }
  | { type: "block"; block: string; context: any }
  | {
      type: "entry";
      roleName: string;
      integrityZomeName: string;
      entryType: string;
      hrl: Hrl;
      context: any;
    };

export type CrossAppletView =
  | {
      type: "main";
    }
  | {
      type: "block";
      block: string;
      context: any;
    };


export interface BlockType {
  label: string;
  icon_src: string;
  view: "applet-view" | "cross-applet-view";
}

export type BlockName = string;

export type RenderInfo = {
  type: "applet-view",
  view: AppletView,
  appletClient: AppAgentClient,
  profilesClient: ProfilesClient,
  appletHash: AppletHash,
  /**
   * Non-exhaustive array of profiles of the groups the given applet is shared with.
   * Note that an applet may be shared with other groups beyond the ones returned
   * by this array if the applet has been federated with groups that the agent
   * of the given We instance is not part of.
   */
  groupProfiles: GroupProfile[],
} | {
  type: "cross-applet-view",
  view: CrossAppletView,
  applets: ReadonlyMap<EntryHash, AppletClients>,
}

export type RenderView =
  | {
      type: "applet-view";
      view: AppletView;
    }
  | {
      type: "cross-applet-view";
      view: CrossAppletView;
    }
  | {
      type: "background-service";
      view: null;
  };


export type ParentToAppletRequest =
  | {
      type: "get-applet-entry-info";
      roleName: string;
      integrityZomeName: string;
      entryType: string;
      hrl: Hrl;
    }
  | {
      type: "get-applet-attachment-types";
    }
  | {
      type: "get-block-types";
    }
  | {
      type: "search";
      filter: string;
    }
  | {
      type: "create-attachment";
      attachmentType: string;
      attachToHrl: Hrl;
};

export interface AppletToParentMessage {
  appletHash: EntryHash;
  request: AppletToParentRequest;
}

export type AppletToParentRequest =
  | {
      type: "ready";
    }
  | {
      type: "get-iframe-config";
      crossApplet: boolean;
    }
  | {
      type: "get-hrl-location";
      hrl: Hrl;
    }
  | {
      type: "sign-zome-call";
      request: CallZomeRequest;
    }
  | {
      type: "open-view";
      request: OpenViewRequest;
    }
  | {
      type: "create-attachment";
      request: CreateAttachmentRequest;
    }
  | {
      type: "search";
      filter: string;
    }
  | {
      type: "notify-we";
      notifications: Array<WeNotification>;
  }
  | {
      type: "get-applet-info";
      appletHash: AppletHash;
    }
  | {
      type: "get-global-attachment-types";
    }
  | {
      type: "get-group-profile";
      groupId: DnaHash;
    }
  | {
      type: "get-global-entry-info";
      hrl: Hrl;
    }
  | {
      type: "hrl-to-clipboard";
      hrl: HrlWithContext;
    }
  | {
      type: "user-select-hrl";
    }
  | {
      type: "toggle-clipboard";
    }
  | {
      type: "localStorage.setItem";
      key: string;
      value: string;
    }
  | {
      type: "localStorage.removeItem";
      key: string;
    }
  | {
      type: "localStorage.clear";
    }
  | {
      type: "get-localStorage";
};



export type OpenViewRequest =
  | {
      type: "applet-main";
      appletHash: EntryHash;
    }
  | {
      type: "cross-applet-main";
      appletBundleId: ActionHash;
    }
  | {
      type: "applet-block";
      appletHash: EntryHash;
      block: string;
      context: any;
    }
  | {
      type: "cross-applet-block";
      appletBundleId: ActionHash;
      block: string;
      context: any;
    }
  | {
      type: "hrl";
      hrl: Hrl;
      context: any;
};

export interface CreateAttachmentRequest {
  appletHash: EntryHash;
  attachmentType: string;
  attachToHrl: Hrl;
}

export interface InternalAttachmentType {
  label: string;
  icon_src: string;
}

export type IframeConfig =
  | {
      type: "applet";
      appPort: number;
      appletHash: EntryHash;
      profilesLocation: ProfilesLocation;
      groupProfiles: GroupProfile[];
    }
  | {
      type: "cross-applet";
      appPort: number;
      applets: Record<EntryHashB64, ProfilesLocation>;
    }
  | {
      type: "not-installed";
      appletName: string;
};

export interface ProfilesLocation {
  profilesAppId: string;
  profilesRoleName: string;
}

export interface HrlLocation {
  roleName: string;
  integrityZomeName: string;
  entryType: string;
}
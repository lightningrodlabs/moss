import { ActionHash, AppAgentClient, EntryHash, RoleName, ZomeName, decodeHashFromBase64, encodeHashToBase64, } from "@holochain/client";
import { BlockType, AttachmentType, EntryInfo, Hrl, HrlWithContext, WeNotification, RenderInfo, AttachmentName, BlockName, AppletHash, AppletInfo, EntryLocationAndInfo,  } from "./types";


declare global {
  interface Window {
    __WE_API__: WeServices,
    __WE_APPLET_SERVICES__: AppletServices,
    __WE_RENDER_INFO__: RenderInfo,
  }
}

/**
 *
 * @returns bool: Returns whether this function is being called in a We context.
 */
export const isWeContext = () => window.location.protocol === "applet:";

/**
 *
 * @param appletHash Hash of the applet to generate the link for
 * @param webPrefix Whether to make the link work via web browsers. Default is true.
 * @returns
 */
export const weLinkFromAppletHash = (appletHash: AppletHash, webPrefix = true) => {
  let link: string = "";
  if (webPrefix) {
    link = "https://lightningrodlabs.org/we?"
  }
  link = link + `we://applet/${encodeHashToBase64(appletHash)}`;
  return link
}

export class AppletServices {
  constructor() {
    this.attachmentTypes = async (_appletClient,_appletHash, _weServices) => ({}),
    this.blockTypes = {},
    this.search = async (_appletClient, _appletHash, _weServices, _searchFilter) => [],
    this.getEntryInfo = async (
      _appletClient,
      _roleName,
      _integrityZomeName,
      _entryType,
      _hrl
    ) => undefined
  }

  /**
   * Attachment types that this Applet offers for other Applets to attach
   */
  attachmentTypes: (appletClient: AppAgentClient, appletHash: AppletHash, weServices: WeServices) => Promise<Record<AttachmentName, AttachmentType>>;
  /**
   * Render block types that this Applet offers
   */
  blockTypes: Record<BlockName, BlockType>;
  /**
   * Get info about the specified entry of this Applet
   */
  getEntryInfo: (
    appletClient: AppAgentClient,
    roleName: RoleName,
    integrityZomeName: ZomeName,
    entryType: string,
    hrl: Hrl,
  ) => Promise<EntryInfo | undefined>;
  /**
   * Search in this Applet
   */
  search: (appletClient: AppAgentClient, appletHash: AppletHash, weServices: WeServices, searchFilter: string) => Promise<Array<HrlWithContext>>;
}

export interface WeServices {
  /**
   * Available attachment types across all We Applets
   * @returns
   */
  attachmentTypes: ReadonlyMap<AppletHash, Record<AttachmentName, AttachmentType>>;
  /**
   * Open the main view of the specified Applet
   * @param appletHash
   * @returns
   */
  openAppletMain: (appletHash: EntryHash) => Promise<void>;
  /**
   * Open the specified block view of the specified Applet
   * @param appletHash
   * @param block
   * @param context
   * @returns
   */
  openAppletBlock: (appletHash, block: string, context: any) => Promise<void>;
  /**
   * Open the cross-applet main view of the specified Applet Type.
   * @param appletBundleId
   * @returns
   */
  openCrossAppletMain: (appletBundleId: ActionHash) => Promise<void>;
  /**
   * Open the specified block view of the specified Applet Type
   * @param appletBundleId
   * @param block
   * @param context
   * @returns
   */
  openCrossAppletBlock: (appletBundleId: ActionHash, block: string, context: any) => Promise<void>;
  /**
   * Open the specified HRL as an entry view
   * @param hrl
   * @param context
   * @returns
   */
  openHrl: (hrl: Hrl, context: any) => Promise<void>;
  /**
   * Get the group profile of the specified group
   * @param groupId
   * @returns
   */
  groupProfile: (groupId) => Promise<any>;
  /**
   * Returns Applet info of the specified Applet
   * @param appletHash
   * @returns
   */
  appletInfo: (appletHash) => Promise<AppletInfo | undefined>;
  /**
   * Gets information about an entry in any other Applet in We
   * @param hrl
   * @returns
   */
  entryInfo: (hrl: Hrl) => Promise<EntryLocationAndInfo | undefined>;
  /**
   * Adds the specified HRL to the We-internal clipboard
   * @param hrl
   * @returns
   */
  hrlToClipboard: (hrl: HrlWithContext) => Promise<void>;
  /**
   * Searching across all We Applets
   * @param searchFilter
   * @returns
   */
  search: (searchFilter: string) => Promise<any>;
  /**
   * Prompts the user with the search bar and We clipboard to select an HRL.
   * Returns an HrlWithContex as soon as the usser has selected an HRL
   * or undefined if the user cancels the selection process.
   * @returns
   */
  userSelectHrl: () => Promise<HrlWithContext | undefined>;
  /**
   * Sends notifications to We and depending on user settings and urgency level
   * further to the operating system.
   * @param notifications
   * @returns
   */
  notifyWe: (notifications: Array<WeNotification>) => Promise<any>;
}


export class WeClient implements WeServices {

  get renderInfo(): RenderInfo {
    return window.__WE_RENDER_INFO__;
  };
  get attachmentTypes(): ReadonlyMap<AppletHash, Record<AttachmentName, AttachmentType>> {
    return window.__WE_API__.attachmentTypes;
  };

  private constructor() {}

  static async connect(appletServices?: AppletServices): Promise<WeClient> {
    if (window.__WE_RENDER_INFO__) {
      if (appletServices) {
        window.__WE_APPLET_SERVICES__ = appletServices;
      }
      return new WeClient();
    } else {
      await new Promise((resolve, _reject) => {
        const listener = () => {
          document.removeEventListener("applet-iframe-ready", listener);
          resolve(null);
        };
        document.addEventListener("applet-iframe-ready", listener);
        }
      );
      if (appletServices) {
        window.__WE_APPLET_SERVICES__ = appletServices;
      }
      return new WeClient();
    }
  }


  openAppletMain = async (appletHash: EntryHash): Promise<void> =>
    window.__WE_API__.openAppletMain(appletHash);

  openAppletBlock = async (appletHash, block: string, context: any): Promise<void> =>
    window.__WE_API__.openAppletBlock(appletHash, block, context);

  openCrossAppletMain = (appletBundleId: ActionHash): Promise<void> =>
    window.__WE_API__.openCrossAppletMain(appletBundleId);

  openCrossAppletBlock = (appletBundleId: ActionHash, block: string, context: any): Promise<void> =>
    window.__WE_API__.openCrossAppletBlock(appletBundleId, block, context);

  openHrl = (hrl: Hrl, context: any): Promise<void> =>
    window.__WE_API__.openHrl(hrl, context);

  groupProfile = (groupId) =>
    window.__WE_API__.groupProfile(groupId);

  appletInfo = (appletHash) =>
    window.__WE_API__.appletInfo(appletHash);

  entryInfo = (hrl: Hrl) => window.__WE_API__.entryInfo(hrl);

  hrlToClipboard = (hrl: HrlWithContext) =>
    window.__WE_API__.hrlToClipboard(hrl);

  search = (filter: string) =>
    window.__WE_API__.search(filter);

  userSelectHrl = () =>
    window.__WE_API__.userSelectHrl();

  notifyWe = (notifications: Array<WeNotification>) =>
    window.__WE_API__.notifyWe(notifications);
}
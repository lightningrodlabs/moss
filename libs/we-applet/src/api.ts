import {
  ActionHash,
  AppAgentClient,
  EntryHash,
  RoleName,
  ZomeName,
  decodeHashFromBase64,
  encodeHashToBase64,
} from '@holochain/client';
import {
  BlockType,
  AssetInfo,
  WAL,
  RenderInfo,
  BlockName,
  AppletHash,
  AppletInfo,
  AssetLocationAndInfo,
  OpenWalMode,
  CreatableType,
  CreatableName,
  Hrl,
  WeaveLocation,
  FrameNotification,
} from './types';
import { postMessage } from './utils';
import { decode, encode } from '@msgpack/msgpack';
import { fromUint8Array, toUint8Array } from 'js-base64';

declare global {
  interface Window {
    __WE_API__: WeServices;
    __WE_APPLET_SERVICES__: AppletServices;
    __WE_RENDER_INFO__: RenderInfo;
    __isWe__: boolean | undefined;
  }
}

/**
 *
 * @returns bool: Returns whether this function is being called in a We context.
 */
export const isWeContext = () =>
  window.location.protocol === 'applet:' || window.__WE_API__ || window.__isWe__;

/**
 *
 * @param appletHash Hash of the applet to generate the link for
 * @param webPrefix Whether to make the link work via web browsers. Default is true.
 * @returns
 */
export const weaveUrlFromAppletHash = (appletHash: AppletHash, webPrefix = true) => {
  let url: string = '';
  if (webPrefix) {
    url = 'https://lightningrodlabs.org/we?';
  }
  url = url + `we://applet/${encodeHashToBase64(appletHash)}`;
  return url;
};

export function weaveUrlFromWal(wal: WAL, webPrefix = true) {
  let url: string = '';
  if (webPrefix) {
    url = 'https://lightningrodlabs.org/we?';
  }
  url =
    url +
    `we://hrl/${encodeHashToBase64(wal.hrl[0])}/${encodeHashToBase64(wal.hrl[1])}${
      wal.context ? `?context=${encodeContext(wal.context)}` : ''
    }`;
  return url;
}

export function weaveUrlToLocation(url: string): WeaveLocation {
  if (!url.startsWith('we://')) {
    throw new Error(`Got invalid We url: ${url}`);
  }

  const split = url.split('://');
  // ['we', 'hrl/uhC0k-GO_J2D51Ibh2jKjVJHAHPadV7gndBwrqAmDxRW3b…kzMgM3yU2RkmaCoiY8IVcUQx_TLOjJe8SxJVy7iIhoVIvlZrD']
  const split2 = split[1].split('/');
  // ['hrl', 'uhC0k-GO_J2D51Ibh2jKjVJHAHPadV7gndBwrqAmDxRW3buMpVRa9', 'uhCkkzMgM3yU2RkmaCoiY8IVcUQx_TLOjJe8SxJVy7iIhoVIvlZrD']

  if (split2[0] === 'hrl') {
    const contextSplit = split2[2].split('?context=');
    return {
      type: 'asset',
      wal: {
        hrl: [decodeHashFromBase64(split2[1]), decodeHashFromBase64(contextSplit[0])],
        context: contextSplit[1] ? decodeContext(contextSplit[1]) : undefined,
      },
    };
  } else if (split2[0] === 'group') {
    throw new Error(
      'Needs to be implemented in Moss version 0.11.x by changing group to invitation',
    );
  } else if (split2[0] === 'applet') {
    return {
      type: 'applet',
      appletHash: decodeHashFromBase64(split2[1]),
    };
  }
  throw new Error(`Got We url of unknown format: ${url}`);
}

export function weaveUrlToWAL(url: string): WAL {
  const weaveLocation = weaveUrlToLocation(url);
  if (weaveLocation.type !== 'asset') {
    throw new Error('Passed URL is not a valid asset locator.');
  }
  return weaveLocation.wal;
}

export function stringifyHrl(hrl: Hrl): string {
  return `hrl://${encodeHashToBase64(hrl[0])}/${encodeHashToBase64(hrl[1])}`;
}

export function encodeContext(context: any) {
  return fromUint8Array(encode(context), true);
}

export function decodeContext(contextStringified: string): any {
  return decode(toUint8Array(contextStringified));
}

export const initializeHotReload = async () => {
  try {
    const appletIframeScript = await postMessage<string>({
      type: 'get-applet-iframe-script',
    });
    eval(appletIframeScript);
  } catch (e) {
    throw new Error(
      `Failed to initialize applet hot-reloading: ${e}.\n\nIf the applet is running in production mode (.webhapp) 'initializeHotReload()' needs to be removed.`,
    );
  }
};

export class AppletServices {
  constructor() {
    (this.creatables = {}),
      (this.blockTypes = {}),
      (this.search = async (_appletClient, _appletHash, _weServices, _searchFilter) => []),
      (this.getAssetInfo = async (_appletClient, _roleName, _integrityZomeName, _entryType, _wal) =>
        undefined),
      (this.bindAsset = async () => {});
  }

  /**
   * Creatables that this Applet offers to be created from a We dialog
   */
  creatables: Record<CreatableName, CreatableType>;

  /**
   * Render block types that this Applet offers
   */
  blockTypes: Record<BlockName, BlockType>;
  /**
   * Get info about the specified entry of this Applet
   */
  getAssetInfo: (
    appletClient: AppAgentClient,
    roleName: RoleName,
    integrityZomeName: ZomeName,
    entryType: string,
    wal: WAL,
  ) => Promise<AssetInfo | undefined>;
  /**
   * Search in this Applet
   */
  search: (
    appletClient: AppAgentClient,
    appletHash: AppletHash,
    weServices: WeServices,
    searchFilter: string,
  ) => Promise<Array<WAL>>;

  /**
   * Bind an asset (srcWal) to an asset in your applet (dstWal).
   */
  bindAsset: (
    appletClient: AppAgentClient,
    /**
     * Waeve Asset Locator in the applet requesting the binding
     */
    srcWal: WAL,
    /**
     * Weave Asset Locator to which the srcWal should be bound to
     */
    dstWal: WAL,
    /**
     * role name of the dna containing the destination WAL
     */
    dstRoleName: RoleName,
    /**
     * integrity zome containing the destination WAL
     */
    dstIntegrityZomeName: ZomeName,
    /**
     * entry type of the destination WAL
     */
    dstEntryType: string,
  ) => Promise<void>;
}

export interface WeServices {
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
   * Open the specified WAL
   * @param wal
   * @param context
   * @returns
   */
  openWal: (wal: WAL, mode?: OpenWalMode) => Promise<void>;
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
   * @param wal
   * @returns
   */
  assetInfo: (wal: WAL) => Promise<AssetLocationAndInfo | undefined>;
  /**
   * Adds the specified HRL to the We-internal clipboard
   * @param wal
   * @returns
   */
  walToPocket: (wal: WAL) => Promise<void>;
  /**
   * Prompts the user with the search bar and We clipboard to select a WAL.
   * Returns a WAL as soon as the user has selected a WAL
   * or undefined if the user cancels the selection process.
   * @returns
   */
  userSelectWal: () => Promise<WAL | undefined>;
  /**
   * Sends notifications to We and depending on user settings and urgency level
   * further to the operating system.
   * @param notifications
   * @returns
   */
  notifyFrame: (notifications: Array<FrameNotification>) => Promise<any>;
  /**
   * Let's the user select a Screen or Window and returns the selected id. Useful
   * for screen sharing applications.
   */
  userSelectScreen: () => Promise<string>;
  /**
   * Request the applet holding the destination WAL (dstWal) to bind the source
   * WAL (srcWal) to it.
   * The source WAL must belong to the requesting applet.
   */
  requestBind: (srcWal: WAL, dstWal: WAL) => Promise<void>;
}

export class WeClient implements WeServices {
  get renderInfo(): RenderInfo {
    return window.__WE_RENDER_INFO__;
  }

  private constructor() {}

  static async connect(appletServices?: AppletServices): Promise<WeClient> {
    if (window.__WE_RENDER_INFO__) {
      if (appletServices) {
        window.__WE_APPLET_SERVICES__ = appletServices;
      }
      document.dispatchEvent(new CustomEvent('we-client-connected'));
      return new WeClient();
    } else {
      await new Promise((resolve, _reject) => {
        const listener = () => {
          document.removeEventListener('applet-iframe-ready', listener);
          resolve(null);
        };
        document.addEventListener('applet-iframe-ready', listener);
      });
      if (appletServices) {
        window.__WE_APPLET_SERVICES__ = appletServices;
      }
      document.dispatchEvent(new CustomEvent('we-client-connected'));
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

  openWal = (wal: WAL, mode?: OpenWalMode): Promise<void> => window.__WE_API__.openWal(wal, mode);

  groupProfile = (groupId) => window.__WE_API__.groupProfile(groupId);

  appletInfo = (appletHash) => window.__WE_API__.appletInfo(appletHash);

  assetInfo = (wal: WAL) => window.__WE_API__.assetInfo(wal);

  walToPocket = (wal: WAL) => window.__WE_API__.walToPocket(wal);

  userSelectWal = () => window.__WE_API__.userSelectWal();

  notifyFrame = (notifications: Array<FrameNotification>) =>
    window.__WE_API__.notifyFrame(notifications);

  userSelectScreen = () => window.__WE_API__.userSelectScreen();

  requestBind = (srcWal: WAL, dstWal: WAL) => window.__WE_API__.requestBind(srcWal, dstWal);
}

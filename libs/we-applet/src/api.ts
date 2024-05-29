import {
  ActionHash,
  AppClient,
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
  RecordInfo,
  PeerStatusUpdate,
  UnsubscribeFunction,
  GroupPermissionType,
} from './types';
import { postMessage } from './utils.js';
import { decode, encode } from '@msgpack/msgpack';
import { fromUint8Array, toUint8Array } from 'js-base64';

declare global {
  interface Window {
    __WEAVE_API__: WeaveServices;
    __WEAVE_APPLET_SERVICES__: AppletServices;
    __WEAVE_RENDER_INFO__: RenderInfo;
    __isWe__: boolean | undefined;
  }
}

/**
 * The null hash is used in case a WAL is to address a DNA only, not specific
 * DHT content
 */
export const NULL_HASH = new Uint8Array(39);

/**
 *
 * @returns bool: Returns whether this function is being called in a We context.
 */
export const isWeContext = () =>
  window.location.protocol === 'applet:' || !!window.__WEAVE_API__ || window.__isWe__;

/**
 *
 * @param appletHash Hash of the applet to generate the link for
 * @param webPrefix Whether to make the link work via web browsers. Default is true.
 * @returns
 */
export const weaveUrlFromAppletHash = (appletHash: AppletHash, webPrefix = false) => {
  let url: string = '';
  if (webPrefix) {
    url = 'https://theweave.social/wal?';
  }
  url = url + `weave-0.12://applet/${encodeHashToBase64(appletHash)}`;
  return url;
};

export function weaveUrlFromWal(wal: WAL, webPrefix = false) {
  let url: string = '';
  if (webPrefix) {
    url = 'https://theweave.social/wal?';
  }
  url =
    url +
    `weave-0.12://hrl/${encodeHashToBase64(wal.hrl[0])}/${encodeHashToBase64(wal.hrl[1])}${
      wal.context ? `?context=${encodeContext(wal.context)}` : ''
    }`;
  return url;
}

export function weaveUrlToLocation(url: string): WeaveLocation {
  if (!url.startsWith('weave-0.12://')) {
    throw new Error(`Got invalid Weave url: ${url}`);
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
      'Needs to be implemented in Moss version 0.12.x by changing group to invitation',
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
      (this.search = async (_appletClient, _appletHash, _weaveServices, _searchFilter) => []),
      (this.getAssetInfo = async (_appletClient, _wal, _recordInfo) => undefined),
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
    appletClient: AppClient,
    wal: WAL,
    recordInfo?: RecordInfo,
  ) => Promise<AssetInfo | undefined>;
  /**
   * Search in this Applet
   */
  search: (
    appletClient: AppClient,
    appletHash: AppletHash,
    weaveServices: WeaveServices,
    searchFilter: string,
  ) => Promise<Array<WAL>>;

  /**
   * Bind an asset (srcWal) to an asset in your applet (dstWal).
   */
  bindAsset: (
    appletClient: AppClient,
    /**
     * Waeve Asset Locator in the applet requesting the binding
     */
    srcWal: WAL,
    /**
     * Weave Asset Locator to which the srcWal should be bound to
     */
    dstWal: WAL,
    /**
     * Record location of the dna containing the destination WAL
     */
    dstRecordInfo?: RecordInfo,
  ) => Promise<void>;
}

export interface WeaveServices {
  /**
   * Event handler for peer status updates.
   *
   * @param callback Callback that gets called if a peer status update event is emitted
   * @returns
   */
  onPeerStatusUpdate: (callback: (payload: PeerStatusUpdate) => any) => UnsubscribeFunction;
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
   * @param groupHash
   * @returns
   */
  groupProfile: (groupHash) => Promise<any>;
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
  /**
   * Gets the group permission type. May be used to restrict certain actions in the UI.
   * @returns
   */
  myGroupPermissionType: () => Promise<GroupPermissionType>;
}

export class WeaveClient implements WeaveServices {
  get renderInfo(): RenderInfo {
    return window.__WEAVE_RENDER_INFO__;
  }

  private constructor() {}

  static async connect(appletServices?: AppletServices): Promise<WeaveClient> {
    if (window.__WEAVE_RENDER_INFO__) {
      if (appletServices) {
        window.__WEAVE_APPLET_SERVICES__ = appletServices;
      }
      window.dispatchEvent(new CustomEvent('weave-client-connected'));
      return new WeaveClient();
    } else {
      await new Promise((resolve, _reject) => {
        const listener = () => {
          window.removeEventListener('applet-iframe-ready', listener);
          resolve(null);
        };
        window.addEventListener('applet-iframe-ready', listener);
      });
      if (appletServices) {
        window.__WEAVE_APPLET_SERVICES__ = appletServices;
      }
      window.dispatchEvent(new CustomEvent('weave-client-connected'));
      return new WeaveClient();
    }
  }

  onPeerStatusUpdate = (callback: (payload: PeerStatusUpdate) => any): UnsubscribeFunction => {
    return window.__WEAVE_API__.onPeerStatusUpdate(callback);
  };

  openAppletMain = async (appletHash: EntryHash): Promise<void> =>
    window.__WEAVE_API__.openAppletMain(appletHash);

  openAppletBlock = async (appletHash, block: string, context: any): Promise<void> =>
    window.__WEAVE_API__.openAppletBlock(appletHash, block, context);

  openCrossAppletMain = (appletBundleId: ActionHash): Promise<void> =>
    window.__WEAVE_API__.openCrossAppletMain(appletBundleId);

  openCrossAppletBlock = (appletBundleId: ActionHash, block: string, context: any): Promise<void> =>
    window.__WEAVE_API__.openCrossAppletBlock(appletBundleId, block, context);

  openWal = (wal: WAL, mode?: OpenWalMode): Promise<void> =>
    window.__WEAVE_API__.openWal(wal, mode);

  groupProfile = (groupHash) => window.__WEAVE_API__.groupProfile(groupHash);

  appletInfo = (appletHash) => window.__WEAVE_API__.appletInfo(appletHash);

  assetInfo = (wal: WAL) => window.__WEAVE_API__.assetInfo(wal);

  walToPocket = (wal: WAL) => window.__WEAVE_API__.walToPocket(wal);

  userSelectWal = () => window.__WEAVE_API__.userSelectWal();

  notifyFrame = (notifications: Array<FrameNotification>) =>
    window.__WEAVE_API__.notifyFrame(notifications);

  userSelectScreen = () => window.__WEAVE_API__.userSelectScreen();

  requestBind = (srcWal: WAL, dstWal: WAL) => window.__WEAVE_API__.requestBind(srcWal, dstWal);

  myGroupPermissionType = () => window.__WEAVE_API__.myGroupPermissionType();
}

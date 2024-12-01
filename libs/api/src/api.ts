import {
  ActionHash,
  AgentPubKey,
  AppClient,
  CreateCloneCellRequest,
  CreateCloneCellResponse,
  DisableCloneCellRequest,
  EnableCloneCellRequest,
  EntryHash,
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
  OpenAssetMode,
  CreatableType,
  CreatableName,
  Hrl,
  WeaveLocation,
  FrameNotification,
  RecordInfo,
  PeerStatusUpdate,
  UnsubscribeFunction,
  GroupPermissionType,
  AssetStore,
} from './types';
import { postMessage } from './utils.js';
import { decode, encode } from '@msgpack/msgpack';
import { fromUint8Array, toUint8Array } from 'js-base64';

declare global {
  interface Window {
    __WEAVE_API__: WeaveServices;
    __WEAVE_APPLET_SERVICES__: AppletServices;
    __WEAVE_RENDER_INFO__: RenderInfo;
    __WEAVE_PROTOCOL_VERSION__: string;
    __MOSS_VERSION__: string;
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
 * @returns bool: Returns whether this function is being called in a Weave context.
 */
export const isWeaveContext = () =>
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
  url =
    url +
    `weave-${window.__WEAVE_PROTOCOL_VERSION__ || '0.12'}://applet/${encodeHashToBase64(appletHash)}`;
  return url;
};

export function weaveUrlFromWal(wal: WAL, webPrefix = false) {
  let url: string = '';
  if (webPrefix) {
    url = 'https://theweave.social/wal?';
  }
  url =
    url +
    `weave-${window.__WEAVE_PROTOCOL_VERSION__ || '0.12'}://hrl/${encodeHashToBase64(wal.hrl[0])}/${encodeHashToBase64(wal.hrl[1])}${
      wal.context ? `?context=${encodeContext(wal.context)}` : ''
    }`;
  return url;
}

export function weaveUrlToLocation(url: string): WeaveLocation {
  if (!url.startsWith(`weave-${window.__WEAVE_PROTOCOL_VERSION__ || '0.12'}://`)) {
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
      'Needs to be implemented in Moss version 0.13.x by changing group to invitation',
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

export function stringifyWal(wal: WAL): string {
  // If the context field is missing, it will be encoded differently than if it's undefined
  // or null so the field needs to be explicitly added here to make sure it leads to a
  // consistent result in both cases
  wal = {
    hrl: wal.hrl,
    context: 'context' in wal ? wal.context : null,
  };
  return fromUint8Array(encode(wal));
}

export function deStringifyWal(walStringified: string): WAL {
  return decode(toUint8Array(walStringified)) as WAL;
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
      (this.getAssetInfo = async (_appletClient, _wal, _recordInfo) => undefined);
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
}

export interface AssetServices {
  /**
   * Gets information about an entry in any other Applet in We
   * @param wal
   * @returns
   */
  assetInfo: (wal: WAL) => Promise<AssetLocationAndInfo | undefined>;
  /**
   * Communicate that an asset is being dragged
   * @param wal
   * @param context
   * @returns
   */
  dragAsset: (wal: WAL) => Promise<void>;
  /**
   * Adds the specified HRL to the We-internal clipboard
   * @param wal
   * @returns
   */
  assetToPocket: (wal: WAL) => Promise<void>;
  /**
   * Prompts the user with the search bar and Moss pocket to select an Asset.
   * Returns the associated WAL as soon as the user has selected an asset
   * or undefined if the user cancels the selection process.
   * @returns
   */
  userSelectAsset: () => Promise<WAL | undefined>;
  /**
   * Adds new tags to an asset
   *
   * @param wal
   * @param tags
   * @returns
   */
  addTagsToAsset: (wal: WAL, tags: string[]) => Promise<void>;
  /**
   * Removes the given tags from an asset.
   *
   * @param wal
   * @param tags
   * @returns
   */
  removeTagsFromAsset: (wal: WAL, tags: string[]) => Promise<void>;
  /**
   * Adds a new asset relation. This function deliberately returns no value because
   * Tool frontends should subscribe to the AssetStore(s) to update their frontend
   * state.
   *
   * @param srcWal
   * @param dstWal
   * @param tags
   * @returns
   */
  addAssetRelation: (srcWal: WAL, dstWal: WAL, tags?: string[]) => Promise<void>;
  /**
   * Removes an asset relation and all its tags. This function deliberately returns
   * no value because Tool frontends should subscribe to the AssetStore(s) to update
   * their frontend state.
   *
   * @param relationHash
   * @returns
   */
  removeAssetRelation: (relationHash: EntryHash) => Promise<void>;
  /**
   * Adds new tags to an existing asset relation
   *
   * @param relationHash
   * @param tags
   * @returns
   */
  addTagsToAssetRelation: (relationHash: EntryHash, tags: string[]) => Promise<void>;
  /**
   * Removes the specified tags from an asset relation
   *
   * @param relationHash
   * @param tags
   * @returns
   */
  removeTagsFromAssetRelation: (relationHash: EntryHash, tags: string[]) => Promise<void>;
  /**
   * Returns a Svelte readable store that can be subscribed to in order to get updated
   * about the latest information about this asset (tags and other related assets)
   *
   * @param wal
   * @returns
   */
  assetStore: (wal: WAL) => AssetStore;
}

export interface WeaveServices {
  assets: AssetServices;
  /**
   *
   * @returns Version of Moss within which this method is being called in
   */
  mossVersion: () => string;
  /**
   * Event handler for peer status updates.
   *
   * @param callback Callback that gets called if a peer status update event is emitted
   * @returns
   */
  onPeerStatusUpdate: (callback: (payload: PeerStatusUpdate) => any) => UnsubscribeFunction;
  /**
   * Event listener allowing to register a callback that will get executed before the
   * applet gets reloaded, for example to save intermediate user input (e.g. commit
   * the most recent changes of a document to the source chain).
   *
   * If this callback takes too long, users may be offered to force reload, thereby
   * ignoring/cancelling the pending callback.
   *
   * @param callback Callback that gets called before the Applet gets reloaded
   * @returns
   */
  onBeforeUnload: (callback: () => void) => UnsubscribeFunction;
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
   * Open the asset associated to the specified WAL
   * @param wal
   * @param context
   * @returns
   */
  openAsset: (wal: WAL, mode?: OpenAssetMode) => Promise<void>;
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
   * Requests to close the containing window. Will only work if the applet is being run in its
   * own window
   */
  requestClose: () => Promise<void>;
  /**
   * Gets the group permission type. May be used to restrict certain actions in the UI.
   * @returns
   */
  myGroupPermissionType: () => Promise<GroupPermissionType>;
  /**
   * Gets all the agents that joined the Tool instance of the Tool calling this function
   * @returns
   */
  appletParticipants: () => Promise<AgentPubKey[]>;
  /**
   * Allows to send small sized "fire-and-forget" signals to all group participants
   * that are currently online.
   *
   * @param payload Arbitrary payload, for example any msgpack encoded javascript object
   * @returns
   */
  sendRemoteSignal: (payload: Uint8Array) => Promise<void>;
  /**
   * Event listener allowing to register a callback that will get executed if a remote
   * signal that had been sent with `WeaveClient.sendRemoteSignal()` arrives.
   *
   * @param callback
   * @returns
   */
  onRemoteSignal: (callback: (payload: Uint8Array) => any) => UnsubscribeFunction;

  /**
   * Create a cloned cell and optionally have it be registered in the group DNA for other
   * group members or always-online nodes to be able to automatically join it too.
   *
   * @param req
   * @param publicToGroupMembers Whether this cloned cell should be registered in the group DNA such that
   * other group members or alway-online nodes may automatically install it too.
   * @returns
   */
  createCloneCell: (
    req: CreateCloneCellRequest,
    publicToGroupMembers: boolean,
  ) => Promise<CreateCloneCellResponse>;

  enableCloneCell: (req: EnableCloneCellRequest) => Promise<CreateCloneCellResponse>;

  disableCloneCell: (req: DisableCloneCellRequest) => Promise<void>;
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

  mossVersion = () => window.__MOSS_VERSION__;

  onPeerStatusUpdate = (callback: (payload: PeerStatusUpdate) => any): UnsubscribeFunction =>
    window.__WEAVE_API__.onPeerStatusUpdate(callback);

  onBeforeUnload = (callback: () => any): UnsubscribeFunction =>
    window.__WEAVE_API__.onBeforeUnload(callback);

  openAppletMain = async (appletHash: EntryHash): Promise<void> =>
    window.__WEAVE_API__.openAppletMain(appletHash);

  openAppletBlock = async (appletHash, block: string, context: any): Promise<void> =>
    window.__WEAVE_API__.openAppletBlock(appletHash, block, context);

  openCrossAppletMain = (appletBundleId: ActionHash): Promise<void> =>
    window.__WEAVE_API__.openCrossAppletMain(appletBundleId);

  openCrossAppletBlock = (appletBundleId: ActionHash, block: string, context: any): Promise<void> =>
    window.__WEAVE_API__.openCrossAppletBlock(appletBundleId, block, context);

  openAsset = (wal: WAL, mode?: OpenAssetMode): Promise<void> =>
    window.__WEAVE_API__.openAsset(wal, mode);

  assets = {
    dragAsset: (wal: WAL): Promise<void> => window.__WEAVE_API__.assets.dragAsset(wal),
    assetInfo: (wal: WAL) => window.__WEAVE_API__.assets.assetInfo(wal),
    assetToPocket: (wal: WAL) => window.__WEAVE_API__.assets.assetToPocket(wal),
    userSelectAsset: () => window.__WEAVE_API__.assets.userSelectAsset(),
    addTagsToAsset: (wal: WAL, tags: string[]) =>
      window.__WEAVE_API__.assets.addTagsToAsset(wal, tags),
    removeTagsFromAsset: (wal: WAL, tags: string[]) =>
      window.__WEAVE_API__.assets.removeTagsFromAsset(wal, tags),
    addAssetRelation: (srcWal: WAL, dstWal: WAL, tags?: string[]) =>
      window.__WEAVE_API__.assets.addAssetRelation(srcWal, dstWal, tags),
    removeAssetRelation: (relationHash: EntryHash) =>
      window.__WEAVE_API__.assets.removeAssetRelation(relationHash),
    addTagsToAssetRelation: (relationHash: EntryHash, tags: string[]) =>
      window.__WEAVE_API__.assets.addTagsToAssetRelation(relationHash, tags),
    removeTagsFromAssetRelation: (relationHash: EntryHash, tags: string[]) =>
      window.__WEAVE_API__.assets.addTagsToAssetRelation(relationHash, tags),
    assetStore: (wal: WAL) => window.__WEAVE_API__.assets.assetStore(wal),
  };

  groupProfile = (groupHash) => window.__WEAVE_API__.groupProfile(groupHash);

  appletInfo = (appletHash) => window.__WEAVE_API__.appletInfo(appletHash);

  notifyFrame = (notifications: Array<FrameNotification>) =>
    window.__WEAVE_API__.notifyFrame(notifications);

  userSelectScreen = () => window.__WEAVE_API__.userSelectScreen();

  requestClose = () => window.__WEAVE_API__.requestClose();

  myGroupPermissionType = () => window.__WEAVE_API__.myGroupPermissionType();

  appletParticipants = () => window.__WEAVE_API__.appletParticipants();

  sendRemoteSignal = (payload: Uint8Array) => window.__WEAVE_API__.sendRemoteSignal(payload);

  onRemoteSignal = (callback: (payload: Uint8Array) => any) =>
    window.__WEAVE_API__.onRemoteSignal(callback);

  createCloneCell = (req: CreateCloneCellRequest, publicToGroupMembers: boolean) =>
    window.__WEAVE_API__.createCloneCell(req, publicToGroupMembers);

  enableCloneCell = (req: EnableCloneCellRequest) => window.__WEAVE_API__.enableCloneCell(req);

  disableCloneCell = (req: DisableCloneCellRequest) => window.__WEAVE_API__.disableCloneCell(req);
}

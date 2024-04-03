import { get, toPromise } from '@holochain-open-dev/stores';
import {
  AppletInfo,
  AssetInfo,
  AssetLocationAndInfo,
  HrlLocation,
  WAL,
  AppletToParentRequest,
  ParentToAppletRequest,
  IframeConfig,
  BlockType,
  WeServices,
  GroupProfile,
  FrameNotification,
} from '@lightningrodlabs/we-applet';
import { decodeHashFromBase64, DnaHash, encodeHashToBase64 } from '@holochain/client';

import { AppOpenViews } from '../layout/types.js';
import {
  getAppletDevPort,
  getAppletIframeScript,
  selectScreenOrWindow,
  signZomeCallElectron,
} from '../electron-api.js';
import { MossStore } from '../moss-store.js';
// import { AppletNotificationSettings } from './types.js';
import { AppletHash, AppletId } from '../types.js';
import {
  appEntryIdFromDistInfo,
  appIdFromAppletHash,
  getAppletNotificationSettings,
  getNotificationState,
  getNotificationTypeSettings,
  logZomeCall,
  storeAppletNotifications,
  stringifyWal,
  toOriginalCaseB64,
  validateNotifications,
} from '../utils.js';
import { AppletNotificationSettings } from './types.js';
import { AppletStore } from './applet-store.js';
// import {
//   getAppletNotificationSettings,
//   getNotificationState,
//   storeAppletNotifications,
//   validateNotifications,
// } from '../utils.js';

function getAppletIdFromOrigin(origin: string): AppletId {
  const lowercaseB64IdWithPercent = origin.split('://')[1].split('?')[0].split('/')[0];
  const lowercaseB64Id = lowercaseB64IdWithPercent.replace(/%24/g, '$');
  return toOriginalCaseB64(lowercaseB64Id);
}

export async function setupAppletMessageHandler(mossStore: MossStore, openViews: AppOpenViews) {
  window.addEventListener('message', async (message) => {
    try {
      // console.log('and source: ', message.source);
      let receivedAppletId: AppletId;
      // if origin.startswith(applet://) then get it from the origin
      // if ((origin.startswith("http:127.0.0.1") || origin.startwith("http://localhost")) && this.mossStore.isAppletDev) {

      // }
      if (message.origin.startsWith('applet://')) {
        const lowerCaseAppletId = getAppletIdFromOrigin(message.origin);
        // const appletHash = installedApplets.find(
        //   (a) => toLowerCaseB64(encodeHashToBase64(a)) === lowerCaseAppletId,
        // );
        receivedAppletId = lowerCaseAppletId;
      } else if (
        (message.origin.startsWith('http://127.0.0.1') ||
          message.origin.startsWith('http://localhost')) &&
        mossStore.isAppletDev
      ) {
        // in dev mode trust the applet about what it claims
        receivedAppletId = encodeHashToBase64(message.data.appletHash);
      } else if (message.origin.startsWith('default-app://')) {
        // There is another message handler for those messages in we-app.ts.
        return;
      } else {
        throw new Error(`Received message from applet with invalid origin: ${message.origin}`);
      }

      const installedApplets = await toPromise(mossStore.installedApplets);

      const installedAppletHash = installedApplets.find(
        (hash) => encodeHashToBase64(hash) === receivedAppletId,
      );

      if (!installedAppletHash) {
        console.log(
          'appletHash not found. installedApplets: ',
          installedApplets.map((hash) => encodeHashToBase64(hash)),
          // 'lowercaseAppletId: ',
          // lowerCaseAppletId,
        );
        const iframeConfig: IframeConfig = {
          type: 'not-installed',
          appletName: receivedAppletId,
        };
        message.ports[0].postMessage({ type: 'success', result: iframeConfig });
        // throw new Error(`Requested applet is not installed`);
        console.warn("Got a message from an applet that's not installed.");
        return;
      }

      const result = await handleAppletIframeMessage(
        mossStore,
        openViews,
        receivedAppletId,
        message.data.request,
      );
      message.ports[0].postMessage({ type: 'success', result });
    } catch (e) {
      console.error('Error while handling applet iframe message. Error: ', e, 'Message: ', message);
      console.log('appletId: ', encodeHashToBase64(message.data.appletHash));
      message.ports[0].postMessage({ type: 'error', error: (e as any).message });
    }
  });
}

export function buildHeadlessWeClient(mossStore: MossStore): WeServices {
  return {
    async assetInfo(wal: WAL): Promise<AssetLocationAndInfo | undefined> {
      const maybeCachedInfo = mossStore.weCache.assetInfo.value(wal);
      if (maybeCachedInfo) return maybeCachedInfo;

      const dnaHash = wal.hrl[0];

      try {
        const location = await toPromise(mossStore.hrlLocations.get(dnaHash).get(wal.hrl[1]));
        if (!location) return undefined;
        const assetInfo = await toPromise(mossStore.assetInfo.get(stringifyWal(wal)));

        if (!assetInfo) return undefined;

        const assetAndAppletInfo: AssetLocationAndInfo = {
          appletHash: location.dnaLocation.appletHash,
          assetInfo,
        };

        mossStore.weCache.assetInfo.set(assetAndAppletInfo, wal);

        return assetAndAppletInfo;
      } catch (e) {
        console.warn(
          `Failed to get assetInfo for hrl ${wal.hrl.map((hash) =>
            encodeHashToBase64(hash),
          )} with context ${wal.context}: ${e}`,
        );
        return undefined;
      }
    },
    async requestBind(srcWal: WAL, dstWal: WAL): Promise<void> {
      const dstLocation = await toPromise(
        mossStore.hrlLocations.get(dstWal.hrl[0]).get(dstWal.hrl[1]),
      );
      if (!dstLocation) throw new Error('No applet found for the given dstWal');
      const appletStore = await toPromise(
        mossStore.appletStores.get(dstLocation.dnaLocation.appletHash),
      );
      const appletHost = await toPromise(appletStore.host);
      if (!appletHost) throw new Error('No applet host found for applet of dstWal');
      try {
        const result = await appletHost.bindAsset(
          srcWal,
          dstWal,
          dstLocation.dnaLocation.roleName,
          dstLocation.entryDefLocation.integrity_zome,
          dstLocation.entryDefLocation.entry_def,
        );
        // TODO sanitize result format
        return result;
      } catch (e) {
        console.error('Binding failed due to an error in the destination applet: ', e);
        throw new Error(`Binding failed due to an error in the destination applet.`);
      }
    },
    async groupProfile(groupDnaHash: DnaHash): Promise<GroupProfile | undefined> {
      const groupStore = await mossStore.groupStore(groupDnaHash);
      if (groupStore) {
        const groupProfile = await toPromise(groupStore.groupProfile);
        return groupProfile;
      }
      return undefined;
    },
    async appletInfo(appletHash: AppletHash) {
      // TODO not caching is more efficient here
      // const maybeCachedInfo = mossStore.weCache.appletInfo.value(appletHash);
      // if (maybeCachedInfo) return maybeCachedInfo;

      let appletStore: AppletStore | undefined;
      try {
        appletStore = await toPromise(mossStore.appletStores.get(appletHash));
      } catch (e) {
        console.warn(
          'No appletInfo found for applet with id ',
          encodeHashToBase64(appletHash),
          ': ',
          e,
        );
      }
      if (!appletStore) return undefined;
      const groupsForApplet = await toPromise(mossStore.groupsForApplet.get(appletHash));
      const icon = await toPromise(appletStore.logo);

      return {
        appletBundleId: appEntryIdFromDistInfo(appletStore.applet.distribution_info),
        appletName: appletStore.applet.custom_name,
        appletIcon: icon,
        groupsIds: Array.from(groupsForApplet.keys()),
      } as AppletInfo;
    },
    async notifyFrame(_notifications: Array<FrameNotification>) {
      throw new Error('notify is not implemented on headless WeServices.');
    },
    openAppletMain: async () => {},
    openCrossAppletMain: async () => {},
    openWal: async () => {},
    openCrossAppletBlock: async () => {},
    openAppletBlock: async () => {},
    async userSelectWal() {
      throw new Error('userSelectWal is not supported in headless WeServices.');
    },
    async userSelectScreen() {
      throw new Error('userSelectScreen is not supported in headless WeServices.');
    },
    async walToPocket(wal: WAL): Promise<void> {
      mossStore.walToPocket(wal);
    },
  };
}

export async function handleAppletIframeMessage(
  mossStore: MossStore,
  openViews: AppOpenViews,
  appletId: AppletId,
  message: AppletToParentRequest,
) {
  const weServices = buildHeadlessWeClient(mossStore);

  switch (message.type) {
    case 'get-iframe-config':
      const appletHash = decodeHashFromBase64(appletId);
      const isInstalled = await toPromise(mossStore.isInstalled.get(appletHash));
      const appletStore = await toPromise(mossStore.appletStores.get(appletHash));
      if (!isInstalled) {
        const iframeConfig: IframeConfig = {
          type: 'not-installed',
          appletName: appletStore.applet.custom_name,
        };
        return iframeConfig;
      }

      const crossApplet = message.crossApplet;
      if (crossApplet) {
        const applets = await toPromise(
          mossStore.appletsForBundleHash.get(
            appEntryIdFromDistInfo(appletStore.applet.distribution_info),
          ),
        );
        const config: IframeConfig = {
          type: 'cross-applet',
          appPort: mossStore.conductorInfo.app_port,
          applets,
        };
        return config;
      } else {
        const groupsStores = await toPromise(mossStore.groupsForApplet.get(appletHash));

        const groupProfiles = await Promise.all(
          Array.from(groupsStores.values()).map((store) => toPromise(store.groupProfile)),
        );

        const filteredGroupProfiles = groupProfiles.filter(
          (profile) => !!profile,
        ) as GroupProfile[];

        // TODO: change this when personas and profiles is integrated
        const groupStore = Array.from(groupsStores.values())[0];
        const config: IframeConfig = {
          type: 'applet',
          appletHash,
          appPort: mossStore.conductorInfo.app_port,
          profilesLocation: {
            profilesAppId: groupStore.groupClient.appAgentClient.installedAppId,
            profilesRoleName: 'group',
          },
          groupProfiles: filteredGroupProfiles,
        };
        return config;
      }
    case 'get-hrl-location':
      const location0 = await toPromise(
        mossStore.hrlLocations.get(message.hrl[0]).get(message.hrl[1]),
      );
      if (!location0) throw new Error('Hrl not found');

      const hrlLocation: HrlLocation = {
        roleName: location0.dnaLocation.roleName,
        integrityZomeName: location0.entryDefLocation.integrity_zome,
        entryType: location0.entryDefLocation.entry_def,
      };
      return hrlLocation;
    case 'open-view':
      switch (message.request.type) {
        case 'applet-main':
          return openViews.openAppletMain(message.request.appletHash);
        case 'applet-block':
          return openViews.openAppletBlock(
            message.request.appletHash,
            message.request.block,
            message.request.context,
          );
        case 'cross-applet-main':
          return openViews.openCrossAppletMain(message.request.appletBundleId);
        case 'cross-applet-block':
          return openViews.openCrossAppletBlock(
            message.request.appletBundleId,
            message.request.block,
            message.request.context,
          );
        case 'wal':
          return openViews.openWal(message.request.wal, message.request.mode);
      }
    case 'wal-to-pocket':
      mossStore.walToPocket(message.wal);
      break;
    case 'user-select-wal':
      return openViews.userSelectWal();
    case 'user-select-screen':
      return selectScreenOrWindow();
    case 'toggle-pocket':
      return openViews.toggleClipboard();
    case 'notify-frame': {
      console.log(
        '### NOTIFY FRAME ### from applet ',
        appletId,
        'message: ',
        message.notifications,
      );
      if (!message.notifications) {
        throw new Error(
          `Got notification message without notifications attribute: ${JSON.stringify(message)}`,
        );
      }
      const appletHash = decodeHashFromBase64(appletId);
      const appletStore = await toPromise(mossStore.appletStores.get(appletHash));

      const mainWindowFocused = await window.electronAPI.isMainWindowFocused();

      // If the applet that the notification is coming from is already open, and the We main window
      // itself is also open, don't do anything
      const dashboardMode = get(mossStore.dashboardState());
      const assetViewerState = get(mossStore.assetViewerState());

      const ignoreNotification =
        !(assetViewerState.visible && assetViewerState.position === 'front') &&
        dashboardMode.viewType === 'group' &&
        dashboardMode.appletHash &&
        dashboardMode.appletHash.toString() === appletHash.toString() &&
        mainWindowFocused;

      // add notifications to unread messages and store them in the persisted notifications log
      const notifications: Array<FrameNotification> = message.notifications;
      validateNotifications(notifications); // validate notifications to ensure not to corrupt localStorage
      const maybeUnreadNotifications = storeAppletNotifications(
        notifications,
        appletId,
        !ignoreNotification ? true : false,
        mossStore.persistedStore,
      );

      // update the notifications store
      if (maybeUnreadNotifications) {
        appletStore.setUnreadNotifications(getNotificationState(maybeUnreadNotifications));
      }

      // Update feed
      const daysSinceEpoch = Math.floor(Date.now() / 8.64e7);
      mossStore.updateNotificationFeed(appletId, daysSinceEpoch);
      mossStore.updateNotificationFeed(appletId, daysSinceEpoch - 1); // in case it's just around midnight UTC

      // trigger OS notification if allowed by the user and notification is fresh enough (less than 5 minutes old)
      const appletNotificationSettings: AppletNotificationSettings =
        getAppletNotificationSettings(appletId);

      if (!mainWindowFocused) {
        await Promise.all(
          notifications.map(async (notification) => {
            // check whether it's actually a new event or not. Events older than 5 minutes won't trigger an OS notification
            // because it is assumed that they are emitted by the Applet UI upon startup of We and occurred while the
            // user was offline
            if (Date.now() - notification.timestamp < 300000) {
              const notificationTypeSettings = getNotificationTypeSettings(
                notification.notification_type,
                appletNotificationSettings,
              );
              await window.electronAPI.notification(
                notification,
                notificationTypeSettings.showInSystray,
                notificationTypeSettings.allowOSNotification && notification.urgency === 'high',
                appletStore ? encodeHashToBase64(appletStore.appletHash) : undefined,
                appletStore ? appletStore.applet.custom_name : undefined,
              );
            }
          }),
        );
      }
      return;
    }
    case 'get-applet-info':
      return weServices.appletInfo(message.appletHash);
    case 'get-group-profile':
      return weServices.groupProfile(message.groupId);
    case 'get-global-asset-info':
      let assetInfo = await weServices.assetInfo(message.wal);
      if (assetInfo && mossStore.isAppletDev) {
        const appletDevPort = await getAppletDevPort(appIdFromAppletHash(assetInfo.appletHash));
        if (appletDevPort) {
          assetInfo.appletDevPort = appletDevPort;
        }
      }
      return assetInfo;
    case 'request-bind': {
      const srcLocation = await toPromise(
        mossStore.hrlLocations.get(message.srcWal.hrl[0]).get(message.srcWal.hrl[1]),
      );
      if (!srcLocation) throw new Error('No applet found for srcWal.');
      if (encodeHashToBase64(srcLocation.dnaLocation.appletHash) !== appletId)
        throw new Error('Bad bind request: srcWal does not belong to the requesting applet.');

      return weServices.requestBind(message.srcWal, message.dstWal);
    }
    case 'sign-zome-call':
      logZomeCall(message.request, appletId);
      return signZomeCallElectron(message.request);
    case 'creatable-result':
      if (!message.dialogId) throw new Error("Message is missing the 'dialogId' property.");
      if (!message.result) throw new Error("Message is missing the 'result' property.");
      mossStore.setCreatableDialogResult(message.dialogId, message.result);
      break;
    case 'update-creatable-types':
      // TODO validate message content
      mossStore.updateCreatableTypes(appletId, message.value);
      break;
    case 'localStorage.setItem': {
      const appletLocalStorage = mossStore.persistedStore.appletLocalStorage.value(appletId);
      appletLocalStorage[message.key] = message.value;
      mossStore.persistedStore.appletLocalStorage.set(appletLocalStorage, appletId);
      break;
    }
    case 'localStorage.removeItem': {
      const appletLocalStorage = mossStore.persistedStore.appletLocalStorage.value(appletId);
      const filteredStorage = {};
      Object.keys(appletLocalStorage).forEach((key) => {
        if (key !== message.key) {
          filteredStorage[key] = appletLocalStorage[key];
        }
      });
      mossStore.persistedStore.appletLocalStorage.set(filteredStorage, appletId);
      break;
    }
    case 'localStorage.clear': {
      mossStore.persistedStore.appletLocalStorage.set({}, appletId);
      break;
    }
    case 'get-localStorage':
      return mossStore.persistedStore.appletLocalStorage.value(appletId);
    case 'get-applet-iframe-script':
      return getAppletIframeScript();
    default:
      throw Error(`Got unsupported message type: '${message.type}'`);
  }
}

export class AppletHost {
  appletId: AppletId;

  constructor(
    public iframe: HTMLIFrameElement,
    appletId: AppletId,
  ) {
    this.appletId = appletId;
  }

  async getAppletAssetInfo(
    roleName: string,
    integrityZomeName: string,
    entryType: string,
    wal: WAL,
  ): Promise<AssetInfo | undefined> {
    return this.postMessage({
      type: 'get-applet-asset-info',
      roleName,
      integrityZomeName,
      entryType,
      wal,
    });
  }

  bindAsset(
    srcWal: WAL,
    dstWal: WAL,
    dstRoleName: string,
    dstIntegrityZomeName: string,
    dstEntryType: string,
  ): Promise<void> {
    return this.postMessage({
      type: 'bind-asset',
      srcWal,
      dstWal,
      dstRoleName,
      dstIntegrityZomeName,
      dstEntryType,
    });
  }

  search(filter: string): Promise<Array<WAL>> {
    return this.postMessage({
      type: 'search',
      filter,
    });
  }

  getBlocks(): Promise<Record<string, BlockType>> {
    return this.postMessage({
      type: 'get-block-types',
    });
  }

  private async postMessage<T>(request: ParentToAppletRequest) {
    return new Promise<T>((resolve, reject) => {
      const { port1, port2 } = new MessageChannel();

      this.iframe.contentWindow!.postMessage(request, '*', [port2]);

      port1.onmessage = (m) => {
        if (m.data.type === 'success') {
          resolve(m.data.result);
        } else if (m.data.type === 'error') {
          reject(m.data.error);
        }
      };
    });
  }
}

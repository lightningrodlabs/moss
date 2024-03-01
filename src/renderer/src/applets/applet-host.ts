import { get, toPromise } from '@holochain-open-dev/stores';
import {
  AppletInfo,
  AttachableInfo,
  AttachableLocationAndInfo,
  HrlLocation,
  HrlWithContext,
  WeNotification,
  AppletToParentRequest,
  ParentToAppletRequest,
  IframeConfig,
  BlockType,
  WeServices,
  GroupProfile,
} from '@lightningrodlabs/we-applet';
import { decodeHashFromBase64, DnaHash, encodeHashToBase64 } from '@holochain/client';

import { AppOpenViews } from '../layout/types.js';
import {
  getAppletDevPort,
  getAppletIframeScript,
  selectScreenOrWindow,
  signZomeCallElectron,
} from '../electron-api.js';
import { WeStore } from '../we-store.js';
// import { AppletNotificationSettings } from './types.js';
import { AppletHash, AppletId } from '../types.js';
import {
  appEntryIdFromDistInfo,
  appIdFromAppletHash,
  appIdFromAppletId,
  getAppletNotificationSettings,
  getNotificationState,
  getNotificationTypeSettings,
  logZomeCall,
  storeAppletNotifications,
  stringifyHrlWithContext,
  toLowerCaseB64,
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

export async function setupAppletMessageHandler(weStore: WeStore, openViews: AppOpenViews) {
  window.addEventListener('message', async (message) => {
    try {
      // console.log('and source: ', message.source);
      let receivedAppletId: AppletId;
      // if origin.startswith(applet://) then get it from the origin
      // if ((origin.startswith("http:127.0.0.1") || origin.startwith("http://localhost")) && this.weStore.isAppletDev) {

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
        weStore.isAppletDev
      ) {
        // in dev mode trust the applet about what it claims
        receivedAppletId = encodeHashToBase64(message.data.appletHash);
      } else if (message.origin.startsWith('default-app://')) {
        // There is another message handler for those messages in we-app.ts.
        return;
      } else {
        throw new Error(`Received message from applet with invalid origin: ${message.origin}`);
      }

      const installedApplets = await toPromise(weStore.installedApplets);

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
        weStore,
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

export function buildHeadlessWeClient(weStore: WeStore): WeServices {
  return {
    async attachableInfo(
      hrlWithContext: HrlWithContext,
    ): Promise<AttachableLocationAndInfo | undefined> {
      const maybeCachedInfo = weStore.weCache.attachableInfo.value(hrlWithContext);
      if (maybeCachedInfo) return maybeCachedInfo;

      const dnaHash = hrlWithContext.hrl[0];

      try {
        const location = await toPromise(
          weStore.hrlLocations.get(dnaHash).get(hrlWithContext.hrl[1]),
        );
        if (!location) return undefined;
        const attachableInfo = await toPromise(
          weStore.attachableInfo.get(stringifyHrlWithContext(hrlWithContext)),
        );

        if (!attachableInfo) return undefined;

        const attachableAndAppletInfo: AttachableLocationAndInfo = {
          appletHash: location.dnaLocation.appletHash,
          attachableInfo,
        };

        weStore.weCache.attachableInfo.set(attachableAndAppletInfo, hrlWithContext);

        return attachableAndAppletInfo;
      } catch (e) {
        console.warn(
          `Failed to get attachableInfo for hrl ${hrlWithContext.hrl.map((hash) =>
            encodeHashToBase64(hash),
          )} with context ${hrlWithContext.context}: ${e}`,
        );
        return undefined;
      }
    },
    async groupProfile(groupDnaHash: DnaHash): Promise<GroupProfile | undefined> {
      const groupStore = await weStore.groupStore(groupDnaHash);
      if (groupStore) {
        const groupProfile = await toPromise(groupStore.groupProfile);
        return groupProfile;
      }
      return undefined;
    },
    async appletInfo(appletHash: AppletHash) {
      // TODO not caching is more efficient here
      // const maybeCachedInfo = weStore.weCache.appletInfo.value(appletHash);
      // if (maybeCachedInfo) return maybeCachedInfo;

      let applet: AppletStore | undefined;
      try {
        applet = await toPromise(weStore.appletStores.get(appletHash));
      } catch (e) {
        console.warn(
          'No appletInfo found for applet with id ',
          encodeHashToBase64(appletHash),
          ': ',
          e,
        );
      }
      if (!applet) return undefined;
      const groupsForApplet = await toPromise(weStore.groupsForApplet.get(appletHash));

      return {
        appletBundleId: appEntryIdFromDistInfo(applet.applet.distribution_info),
        appletName: applet.applet.custom_name,
        groupsIds: Array.from(groupsForApplet.keys()),
      } as AppletInfo;
    },
    async notifyWe(_notifications: Array<WeNotification>) {
      throw new Error('notify is not implemented on headless WeServices.');
    },
    openAppletMain: async () => {},
    openCrossAppletMain: async () => {},
    openHrl: async () => {},
    openCrossAppletBlock: async () => {},
    openAppletBlock: async () => {},
    async userSelectHrl() {
      throw new Error('userSelectHrl is not supported in headless WeServices.');
    },
    async userSelectScreen() {
      throw new Error('userSelectScreen is not supported in headless WeServices.');
    },
    async hrlToClipboard(hrlWithContext: HrlWithContext): Promise<void> {
      weStore.hrlToClipboard(hrlWithContext);
    },
  };
}

export async function handleAppletIframeMessage(
  weStore: WeStore,
  openViews: AppOpenViews,
  appletId: AppletId,
  message: AppletToParentRequest,
) {
  const weServices = buildHeadlessWeClient(weStore);

  switch (message.type) {
    case 'get-iframe-config':
      const appletHash = decodeHashFromBase64(appletId);
      const isInstalled = await toPromise(weStore.isInstalled.get(appletHash));
      const appletStore = await toPromise(weStore.appletStores.get(appletHash));
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
          weStore.appletsForBundleHash.get(
            appEntryIdFromDistInfo(appletStore.applet.distribution_info),
          ),
        );
        const config: IframeConfig = {
          type: 'cross-applet',
          appPort: weStore.conductorInfo.app_port,
          applets,
        };
        return config;
      } else {
        const groupsStores = await toPromise(weStore.groupsForApplet.get(appletHash));

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
          appPort: weStore.conductorInfo.app_port,
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
        weStore.hrlLocations.get(message.hrl[0]).get(message.hrl[1]),
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
        case 'hrl':
          return openViews.openHrl(message.request.hrlWithContext, message.request.mode);
      }
    case 'hrl-to-clipboard':
      weStore.hrlToClipboard(message.hrlWithContext);
      break;
    case 'user-select-hrl':
      return openViews.userSelectHrl();
    case 'user-select-screen':
      return selectScreenOrWindow();
    case 'toggle-clipboard':
      return openViews.toggleClipboard();
    case 'notify-we': {
      if (!message.notifications) {
        throw new Error(
          `Got notification message without notifications attribute: ${JSON.stringify(message)}`,
        );
      }
      const appletHash = decodeHashFromBase64(appletId);
      const appletStore = await toPromise(weStore.appletStores.get(appletHash));

      const mainWindowFocused = await window.electronAPI.isMainWindowFocused();

      // If the applet that the notification is coming from is already open, and the We main window
      // itself is also open, don't do anything
      const dashboardMode = get(weStore.dashboardState());
      const attachableViewerState = get(weStore.attachableViewerState());

      const ignoreNotification =
        !(attachableViewerState.visible && attachableViewerState.position === 'front') &&
        dashboardMode.viewType === 'group' &&
        dashboardMode.appletHash &&
        dashboardMode.appletHash.toString() === appletHash.toString() &&
        mainWindowFocused;

      // add notifications to unread messages and store them in the persisted notifications log
      const notifications: Array<WeNotification> = message.notifications;
      validateNotifications(notifications); // validate notifications to ensure not to corrupt localStorage
      const maybeUnreadNotifications = storeAppletNotifications(
        notifications,
        appletId,
        !ignoreNotification ? true : false,
        weStore.persistedStore,
      );

      // update the notifications store
      if (maybeUnreadNotifications) {
        appletStore.setUnreadNotifications(getNotificationState(maybeUnreadNotifications));
      }

      // Update feed
      const daysSinceEpoch = Math.floor(Date.now() / 8.64e7);
      weStore.updateNotificationFeed(appletId, daysSinceEpoch);
      weStore.updateNotificationFeed(appletId, daysSinceEpoch - 1); // in case it's just around midnight UTC

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
    case 'get-global-attachable-info':
      console.log("@applet-host: got 'get-attachable-info' message: ", message);
      let attachableInfo = await weServices.attachableInfo(message.hrlWithContext);
      if (attachableInfo && weStore.isAppletDev) {
        const appletDevPort = await getAppletDevPort(
          appIdFromAppletHash(attachableInfo.appletHash),
        );
        if (appletDevPort) {
          attachableInfo.appletDevPort = appletDevPort;
        }
      }
      return attachableInfo;
    case 'sign-zome-call':
      logZomeCall(message.request, appletId);
      return signZomeCallElectron(message.request);
    case 'creatable-result':
      if (!message.dialogId) throw new Error("Message is missing the 'dialogId' property.");
      if (!message.result) throw new Error("Message is missing the 'result' property.");
      weStore.setCreatableDialogResult(message.dialogId, message.result);
      break;
    case 'update-creatable-types':
      // TODO validate message content
      weStore.updateCreatableTypes(appletId, message.value);
      break;
    case 'localStorage.setItem': {
      const appletLocalStorage = weStore.persistedStore.appletLocalStorage.value(appletId);
      appletLocalStorage[message.key] = message.value;
      weStore.persistedStore.appletLocalStorage.set(appletLocalStorage, appletId);
      break;
    }
    case 'localStorage.removeItem': {
      const appletLocalStorage = weStore.persistedStore.appletLocalStorage.value(appletId);
      const filteredStorage = {};
      Object.keys(appletLocalStorage).forEach((key) => {
        if (key !== message.key) {
          filteredStorage[key] = appletLocalStorage[key];
        }
      });
      weStore.persistedStore.appletLocalStorage.set(filteredStorage, appletId);
      break;
    }
    case 'localStorage.clear': {
      weStore.persistedStore.appletLocalStorage.set({}, appletId);
      break;
    }
    case 'get-localStorage':
      return weStore.persistedStore.appletLocalStorage.value(appletId);
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

  async getAppletAttachableInfo(
    roleName: string,
    integrityZomeName: string,
    entryType: string,
    hrlWithContext: HrlWithContext,
  ): Promise<AttachableInfo | undefined> {
    console.log('@applet-host: calling getAppletAttachableInfo()');
    return this.postMessage({
      type: 'get-applet-attachable-info',
      roleName,
      integrityZomeName,
      entryType,
      hrlWithContext,
    });
  }

  search(filter: string): Promise<Array<HrlWithContext>> {
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

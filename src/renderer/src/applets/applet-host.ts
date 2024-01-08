import { pipe, toPromise } from '@holochain-open-dev/stores';
import {
  AppletInfo,
  AttachmentType,
  AttachableInfo,
  AttachableLocationAndInfo,
  HrlLocation,
  HrlWithContext,
  WeNotification,
  AppletToParentRequest,
  ParentToAppletRequest,
  IframeConfig,
  InternalAttachmentType,
  BlockType,
  WeServices,
  GroupProfile,
  AttachmentName,
} from '@lightningrodlabs/we-applet';
import { decodeHashFromBase64, DnaHash, encodeHashToBase64, EntryHash } from '@holochain/client';
import { HoloHashMap } from '@holochain-open-dev/utils';

import { AppOpenViews } from '../layout/types.js';
import {
  getAppletIframeScript,
  selectScreenOrWindow,
  signZomeCallElectron,
} from '../electron-api.js';
import { WeStore } from '../we-store.js';
// import { AppletNotificationSettings } from './types.js';
import { AppletHash, AppletId } from '../types.js';
import {
  appEntryIdFromDistInfo,
  getNotificationState,
  hrlWithContextToB64,
  storeAppletNotifications,
  toOriginalCaseB64,
  validateNotifications,
} from '../utils.js';
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
      let receivedAppletHash: AppletHash;
      // if origin.startswith(applet://) then get it from the origin
      // if ((origin.startswith("http:127.0.0.1") || origin.startwith("http://localhost")) && this.weStore.isAppletDev) {

      // }
      if (message.origin.startsWith('applet://')) {
        const lowerCaseAppletId = getAppletIdFromOrigin(message.origin);
        // const appletHash = installedApplets.find(
        //   (a) => toLowerCaseB64(encodeHashToBase64(a)) === lowerCaseAppletId,
        // );
        receivedAppletHash = decodeHashFromBase64(lowerCaseAppletId);
      } else if (
        (message.origin.startsWith('http://127.0.0.1') ||
          message.origin.startsWith('http://localhost')) &&
        weStore.isAppletDev
      ) {
        // in dev mode trust the applet about what it claims
        receivedAppletHash = message.data.appletHash;
      } else if (message.origin.startsWith('default-app://')) {
        // There is another message handler for those messages in we-app.ts.
        return;
      } else {
        throw new Error(`Received message from applet with invalid origin: ${message.origin}`);
      }

      const installedApplets = await toPromise(weStore.installedApplets);

      const installedAppletHash = installedApplets.find(
        (hash) => encodeHashToBase64(hash) === encodeHashToBase64(receivedAppletHash),
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
          appletName: encodeHashToBase64(receivedAppletHash),
        };
        message.ports[0].postMessage({ type: 'success', result: iframeConfig });
        // throw new Error(`Requested applet is not installed`);
        console.warn("Got a message from an applet that's not installed.");
        return;
      }

      const result = await handleAppletIframeMessage(
        weStore,
        openViews,
        receivedAppletHash,
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
    // background-services don't need to provide global attachment types as they are available via the WeStore anyway.
    attachmentTypes: new HoloHashMap<AppletHash, Record<AttachmentName, AttachmentType>>(),
    async attachableInfo(
      hrlWithConext: HrlWithContext,
    ): Promise<AttachableLocationAndInfo | undefined> {
      const dnaHash = hrlWithConext.hrl[0];

      try {
        const location = await toPromise(
          weStore.hrlLocations.get(dnaHash).get(hrlWithConext.hrl[1]),
        );
        if (!location) return undefined;
        const attachableInfo = await toPromise(
          weStore.attachableInfo.get(JSON.stringify(hrlWithContextToB64(hrlWithConext))),
        );

        if (!attachableInfo) return undefined;

        const attachableAndAppletInfo: AttachableLocationAndInfo = {
          appletHash: location.dnaLocation.appletHash,
          attachableInfo,
        };

        return attachableAndAppletInfo;
      } catch (e) {
        console.warn(
          `Failed to get attachableInfo for hrl ${hrlWithConext.hrl.map((hash) =>
            encodeHashToBase64(hash),
          )} with context ${hrlWithConext.context}: ${e}`,
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
      const applet = await toPromise(weStore.appletStores.get(appletHash));
      if (!applet) return undefined;
      const groupsForApplet = await toPromise(weStore.groupsForApplet.get(appletHash));

      return {
        appletBundleId: appEntryIdFromDistInfo(applet.applet.distribution_info),
        appletName: applet.applet.custom_name,
        groupsIds: Array.from(groupsForApplet.keys()),
      } as AppletInfo;
    },
    async search(filter: string) {
      // console.log('%%%%%% @headlessWeClient: searching...');
      const hosts = await toPromise(weStore.allAppletsHosts);
      // console.log(
      //   '%%%%%% @headlessWeClient: got hosts: ',
      //   Array.from(hosts.keys()).map((hash) => encodeHashToBase64(hash)),
      // );

      const promises: Array<Promise<Array<HrlWithContext>>> = [];

      // TODO fix case where applet host failed to initialize
      for (const host of Array.from(hosts.values())) {
        promises.push(
          (async () => {
            try {
              // console.log(`searching for host ${host?.appletId}...`);
              const results = host ? await host.search(filter) : [];
              // console.log(`Got results for host ${host?.appletId}: ${JSON.stringify(results)}`);
              return results;
            } catch (e) {
              console.warn(`Search in applet ${host?.appletId} failed: ${e}`);
              return [];
            }
          })(),
        );
      }

      const hrlsWithApplets = await Promise.all(promises);
      // console.log('%%%%%% @headlessWeClient: got hosts with applets: ', hrlsWithApplets);
      const hrls = ([] as Array<HrlWithContext>)
        .concat(...(hrlsWithApplets.filter((h) => !!h) as Array<Array<HrlWithContext>>))
        .filter((h) => !!h);
      return hrls;
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
    async hrlToClipboard(hrlWithConext: HrlWithContext): Promise<void> {
      weStore.hrlToClipboard(hrlWithConext);
    },
  };
}

export async function handleAppletIframeMessage(
  weStore: WeStore,
  openViews: AppOpenViews,
  appletHash: EntryHash,
  message: AppletToParentRequest,
) {
  let host: AppletHost | undefined;
  const weServices = buildHeadlessWeClient(weStore);

  const appletLocalStorageKey = `appletLocalStorage#${encodeHashToBase64(appletHash)}`;

  switch (message.type) {
    case 'get-iframe-config':
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
          return openViews.openHrl(message.request.hrl, message.request.context);
      }
      break;
    case 'hrl-to-clipboard':
      weStore.hrlToClipboard(message.hrl);
      break;
    case 'search':
      return weServices.search(message.filter);
    case 'user-select-hrl':
      return openViews.userSelectHrl();
    case 'user-select-screen':
      return selectScreenOrWindow();
    case 'toggle-clipboard':
      return openViews.toggleClipboard();
    case 'notify-we': {
      const appletId: AppletId = encodeHashToBase64(appletHash);
      if (!message.notifications) {
        throw new Error(
          `Got notification message without notifications attribute: ${JSON.stringify(message)}`,
        );
      }
      const appletStore = await toPromise(weStore.appletStores.get(appletHash));

      // const mainWindowFocused = await isMainWindowFocused();
      // const windowFocused = await appWindow.isFocused();
      // const windowVisible = await appWindow.isVisible();

      // If the applet that the notification is coming from is already open, and the We main window
      // itself is also open, don't do anything
      // const selectedAppletHash = get(weStore.selectedAppletHash());
      // if (
      //   selectedAppletHash &&
      //   selectedAppletHash.toString() === appletHash.toString() &&
      //   windowFocused
      // ) {
      //   return;
      // }

      // add notifications to unread messages and store them in the persisted notifications log
      const notifications: Array<WeNotification> = message.notifications;
      validateNotifications(notifications); // validate notifications to ensure not to corrupt localStorage
      const unreadNotifications = storeAppletNotifications(notifications, appletId);

      // update the notifications store
      appletStore.setUnreadNotifications(getNotificationState(unreadNotifications));

      // // trigger OS notification if allowed by the user and notification is fresh enough (less than 10 minutes old)
      // const appletNotificationSettings: AppletNotificationSettings =
      //   getAppletNotificationSettings(appletId);

      // await Promise.all(
      //   notifications.map(async (notification) => {
      //     // check whether it's actually a new event or not. Events older than 5 minutes won't trigger an OS notification
      //     // because it is assumed that they are emitted by the Applet UI upon startup of We and occurred while the
      //     // user was offline
      //     if (Date.now() - notification.timestamp < 300000) {
      //       console.log('notifying electron main process');
      //       await notifyElectron(
      //         notification,
      //         appletNotificationSettings.showInSystray && !windowVisible,
      //         appletNotificationSettings.allowOSNotification && notification.urgency === 'high',
      //         // appletStore ? encodeHashToBase64(appletStore.applet.appstore_app_hash) : undefined,
      //         appletStore ? appletStore.applet.custom_name : undefined,
      //       );
      //     }
      //   }),
      // );
      return;
    }

    case 'get-applet-info':
      return weServices.appletInfo(message.appletHash);
    case 'get-group-profile':
      return weServices.groupProfile(message.groupId);
    case 'get-global-attachable-info':
      console.log("@applet-host: got 'get-attachable-info' message: ", message);
      return weServices.attachableInfo(message.hrlWithContext);
    case 'get-global-attachment-types':
      return toPromise(weStore.allAttachmentTypes);
    case 'sign-zome-call':
      return signZomeCallElectron(message.request);
    case 'create-attachment':
      host = await toPromise(
        pipe(
          weStore.appletStores.get(message.request.appletHash),
          (appletStore) => appletStore!.host,
        ),
      );
      return host
        ? host.createAttachment(
            message.request.attachmentType,
            message.request.attachToHrlWithContext,
          )
        : Promise.reject(new Error('No applet host available.'));
    case 'localStorage.setItem':
      const appletLocalStorageJson: string | null =
        window.localStorage.getItem(appletLocalStorageKey);
      const appletLocalStorage: Record<string, string> = appletLocalStorageJson
        ? JSON.parse(appletLocalStorageJson)
        : {};
      appletLocalStorage[message.key] = message.value;
      window.localStorage.setItem(appletLocalStorageKey, JSON.stringify(appletLocalStorage));
      break;
    case 'localStorage.removeItem':
      const appletLocalStorageJson2: string | null =
        window.localStorage.getItem(appletLocalStorageKey);
      const appletLocalStorage2: Record<string, string> = appletLocalStorageJson2
        ? JSON.parse(appletLocalStorageJson2)
        : undefined;
      if (appletLocalStorage2) {
        const filteredStorage = {};
        Object.keys(appletLocalStorage2).forEach((key) => {
          if (key !== message.key) {
            filteredStorage[key] = appletLocalStorage2[key];
          }
        });
        window.localStorage.setItem(appletLocalStorageKey, JSON.stringify(filteredStorage));
      }
      break;
    case 'localStorage.clear':
      window.localStorage.removeItem(`appletLocalStorage#${encodeHashToBase64(appletHash)}`);
      break;
    case 'get-localStorage':
      return window.localStorage.getItem(appletLocalStorageKey);
    case 'get-applet-iframe-script':
      return getAppletIframeScript();
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

  createAttachment(
    attachmentType: string,
    attachToHrlWithContext: HrlWithContext,
  ): Promise<HrlWithContext> {
    return this.postMessage({
      type: 'create-attachment',
      attachmentType,
      attachToHrlWithContext,
    });
  }

  async getAppletAttachmentTypes(): Promise<Record<string, InternalAttachmentType>> {
    return this.postMessage({
      type: 'get-applet-attachment-types',
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

import { get, toPromise } from '@holochain-open-dev/stores';
import {
  type AssetInfo,
  type AssetLocationAndInfo,
  type WAL,
  type AppletToParentRequest,
  type ParentToAppletMessage,
  type IframeConfig,
  type BlockType,
  type WeaveServices,
  type GroupProfile,
  type FrameNotification,
  type RecordInfo,
  type PeerStatusUpdate,
} from '@theweave/api';
import { decodeHashFromBase64, DnaHash, encodeHashToBase64, EntryHash } from '@holochain/client';

import { AppOpenViews } from '../layout/types.js';
import {
  getAppletDevPort,
  getAppletIframeScript,
  selectScreenOrWindow,
  signZomeCallApplet,
} from '../electron-api.js';
import { MossStore } from '../moss-store.js';
// import { AppletNotificationSettings } from './types.js';
import { AppletHash, AppletId, stringifyWal } from '@theweave/api';
import {
  getAppletNotificationSettings,
  getNotificationState,
  getNotificationTypeSettings,
  logAppletZomeCall,
  openWalInWindow,
  storeAppletNotifications,
  validateNotifications,
} from '../utils.js';
import { AppletToParentRequest as AppletToParentRequestSchema } from '../validationSchemas.js';
import { AppletNotificationSettings } from './types.js';
import { AppletStore } from './applet-store.js';
import { Value } from '@sinclair/typebox/value';
import { GroupRemoteSignal, PermissionType } from '@theweave/group-client';
import {
  appIdFromAppletHash,
  appIdFromAppletId,
  toolCompatibilityIdFromDistInfoString,
  toOriginalCaseB64,
} from '@theweave/utils';
import { GroupStore, OFFLINE_THRESHOLD } from '../groups/group-store.js';
import { HrlLocation } from '../processes/hrl/locate-hrl.js';

function getAppletIdFromOrigin(origin: string): AppletId {
  const lowercaseB64IdWithPercent = origin.split('://')[1].split('?')[0].split('/')[0];
  const lowercaseB64Id = lowercaseB64IdWithPercent.replace(/%24/g, '$');
  return toOriginalCaseB64(lowercaseB64Id);
}

export function appletMessageHandler(
  mossStore: MossStore,
  openViews: AppOpenViews,
): (message: any) => Promise<void> {
  return async (message) => {
    try {
      // console.log('and source: ', message.source);
      let receivedAppletId: AppletId;
      // if origin.startswith(applet://) then get it from the origin
      // if ((origin.startswith("http:127.0.0.1") || origin.startwith("http://localhost")) && this.mossStore.isAppletDev) {

      // }
      if (message.origin.startsWith('applet://')) {
        const appletId = getAppletIdFromOrigin(message.origin);
        // const appletHash = installedApplets.find(
        //   (a) => toLowerCaseB64(encodeHashToBase64(a)) === lowerCaseAppletId,
        // );
        receivedAppletId = appletId;
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
  };
}

export function buildHeadlessWeaveClient(mossStore: MossStore): WeaveServices {
  return {
    mossVersion() {
      return mossStore.version;
    },
    onPeerStatusUpdate(_) {
      return () => undefined;
    },
    onBeforeUnload(_) {
      return () => undefined;
    },
    onRemoteSignal(_) {
      return () => undefined;
    },
    assets: {
      assetInfo: async (wal: WAL): Promise<AssetLocationAndInfo | undefined> => {
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
      userSelectAsset: () => {
        throw new Error('userSelectWal is not supported in headless WeaveServices.');
      },
      assetToPocket: async (wal: WAL) => {
        mossStore.walToPocket(wal);
      },
      dragAsset: async (wal: WAL) => {
        mossStore.dragWal(wal);
      },
      addTagsToAsset: (_wal: WAL, _tags: string[]) => {
        throw new Error('addTagsToAsset is not supported in headless WeaveServices.');
      },
      removeTagsFromAsset: (_wal: WAL, _tags: string[]) => {
        throw new Error('removeTagsFromAsset is not supported in headless WeaveServices.');
      },
      addAssetRelation: (_srcWal: WAL, _dstWal: WAL, _tags?: string[]) => {
        throw new Error('removeTagsFromAsset is not supported in headless WeaveServices.');
      },
      removeAssetRelation: (_relationHash: EntryHash) => {
        throw new Error('removeAssetRelation is not supported in headless WeaveServices.');
      },
      addTagsToAssetRelation: (_relationHash: EntryHash, _tags: string[]) => {
        throw new Error('addTagsToAssetRelation is not supported in headless WeaveServices.');
      },
      removeTagsFromAssetRelation: (_relationHash: EntryHash, _tags: string[]) => {
        throw new Error('removeTagsFromAssetRelation is not supported in headless WeaveServices.');
      },
      getAllAssetRelationTags: (_) => {
        throw new Error('getAllAssetRelationTags is not supported in headless WeaveServices.');
      },
      assetStore: (_wal: WAL) => {
        throw new Error('assetStore is not supported in headless WeaveServices.');
      },
    },
    async requestClose() {
      throw new Error('Close request is not supported in the headless WeaveClient.');
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
      const icon = await toPromise(mossStore.appletLogo.get(appletHash));

      return {
        appletBundleId: toolCompatibilityIdFromDistInfoString(appletStore.applet.distribution_info),
        appletName: appletStore.applet.custom_name,
        appletIcon: icon!,
        groupsHashes: Array.from(groupsForApplet.keys()),
      };
    },
    async notifyFrame(_notifications: Array<FrameNotification>) {
      throw new Error('notify is not implemented on headless WeaveServices.');
    },
    openAppletMain: async () => {},
    openCrossGroupMain: async () => {},
    openAsset: async () => {},
    openCrossGroupBlock: async () => {},
    openAppletBlock: async () => {},
    async userSelectScreen() {
      throw new Error('userSelectScreen is not supported in headless WeaveServices.');
    },
    async myGroupPermissionType() {
      throw new Error('myGroupPermissionType is not supported in headless WeaveServices.');
    },
    async appletParticipants() {
      throw new Error('appletParticipants is not supported in headless WeaveServices.');
    },
    sendRemoteSignal(_) {
      throw new Error('sendRemoteSignal is not supported in headless WeaveServices.');
    },
    createCloneCell(_) {
      throw new Error('createCloneCell is not supported in headless WeaveServices.');
    },
    enableCloneCell(_) {
      throw new Error('enableCloneCell is not supported in headless WeaveServices.');
    },
    disableCloneCell(_) {
      throw new Error('disableCloneCell is not supported in headless WeaveServices.');
    },
  };
}

export async function handleAppletIframeMessage(
  mossStore: MossStore,
  openViews: AppOpenViews,
  appletId: AppletId,
  message: AppletToParentRequest,
) {
  // Validate the format of the iframe message
  try {
    Value.Assert(AppletToParentRequestSchema, message);
  } catch (e) {
    console.error(
      'Got invalid AppletToParentRequest format. Got request ',
      message,
      '\n\nError: ',
      e,
    );
    return;
  }

  const weaveServices = buildHeadlessWeaveClient(mossStore);

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

      const crossGroup = message.crossGroup;
      if (crossGroup) {
        const applets = await toPromise(
          mossStore.appletsForToolId.get(
            toolCompatibilityIdFromDistInfoString(appletStore.applet.distribution_info),
          ),
        );
        const config: IframeConfig = {
          type: 'cross-applet',
          appPort: mossStore.conductorInfo.app_port,
          mainUiOrigin: window.location.origin,
          weaveProtocolVersion: mossStore.conductorInfo.weave_protocol_version,
          mossVersion: mossStore.conductorInfo.moss_version,
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
          mainUiOrigin: window.location.origin,
          authenticationToken: appletStore.authenticationToken,
          appPort: mossStore.conductorInfo.app_port,
          weaveProtocolVersion: mossStore.conductorInfo.weave_protocol_version,
          mossVersion: mossStore.conductorInfo.moss_version,
          profilesLocation: {
            authenticationToken: groupStore.groupClient.authenticationToken,
            profilesRoleName: 'group',
          },
          groupProfiles: filteredGroupProfiles,
        };
        return config;
      }
    case 'get-record-info': {
      const location = await toPromise(
        mossStore.hrlLocations.get(message.hrl[0]).get(message.hrl[1]),
      );
      if (!location || !location.entryDefLocation) throw new Error('Record not found');

      const recordInfo: RecordInfo = {
        roleName: location.dnaLocation.roleName,
        integrityZomeName: location.entryDefLocation.integrity_zome,
        entryType: location.entryDefLocation.entry_def,
      };
      return recordInfo;
    }
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
        case 'cross-group-main':
          return openViews.openCrossGroupMain(message.request.appletBundleId);
        case 'cross-group-block':
          return openViews.openCrossGroupBlock(
            message.request.appletBundleId,
            message.request.block,
            message.request.context,
          );
        case 'asset':
          if (message.request.mode === 'window') {
            return openWalInWindow(message.request.wal, appletId, mossStore);
          }

          return openViews.openAsset(message.request.wal, message.request.mode);
      }
    case 'user-select-screen':
      return selectScreenOrWindow();
    case 'toggle-pocket':
      return openViews.toggleClipboard();
    case 'notify-frame': {
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

      const ignoreNotification =
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
      return weaveServices.appletInfo(message.appletHash);
    case 'get-group-profile':
      return weaveServices.groupProfile(message.groupHash);
    case 'get-global-asset-info':
      let assetInfo = await weaveServices.assets.assetInfo(message.wal);
      if (assetInfo && mossStore.isAppletDev) {
        const appletDevPort = await getAppletDevPort(appIdFromAppletHash(assetInfo.appletHash));
        if (appletDevPort) {
          assetInfo.appletDevPort = appletDevPort;
        }
      }
      return assetInfo;
    case 'my-group-permission-type': {
      const appletHash = decodeHashFromBase64(appletId);
      const groupStores = await toPromise(mossStore.groupsForApplet.get(appletHash));
      if (groupStores.size === 0) throw new Error('No group store found for applet.');
      const groupPermissions: PermissionType[] = [];
      await Promise.all(
        Array.from(groupStores.values()).map(async (store) => {
          const permission = await toPromise(store.permissionType);
          groupPermissions.push(permission);
        }),
      );

      if (groupPermissions.length > 1)
        return {
          type: 'Ambiguous',
        };

      switch (groupPermissions[0].type) {
        case 'Member':
          return {
            type: 'Member',
          };
        case 'Progenitor':
          return {
            type: 'Steward',
          };
        case 'Steward': {
          const expiry = groupPermissions[0].content.permission.expiry;
          return {
            type: 'Steward',
            expiry: expiry ? expiry / 1000 : undefined,
          };
        }
      }
    }
    case 'applet-participants': {
      const appletHash = decodeHashFromBase64(appletId);
      const groupStores = await toPromise(mossStore.groupsForApplet.get(appletHash));
      if (groupStores.size === 0) throw new Error('No group store found for applet.');

      // TODO: Think through in case multiple groups are supposed to be possible again
      // for the same applet.
      const groupStore = Array.from(groupStores.values())[0];
      const appletAgents = await groupStore.groupClient.getJoinedAppletAgents(appletHash);
      return appletAgents.map((appletAgent) => appletAgent.applet_pubkey);
    }
    case 'sign-zome-call':
      logAppletZomeCall(message.request, appletId);
      return signZomeCallApplet(message.request);
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
    case 'request-close':
      // Only supported in external windows
      return;
    case 'send-remote-signal': {
      const appletHash = decodeHashFromBase64(appletId);
      const groupStores = await toPromise(mossStore.groupsForApplet.get(appletHash));
      const remoteSignalPayload: GroupRemoteSignal = {
        type: 'applet-signal',
        appletId,
        payload: message.payload,
      };
      // For every group store, get the currently online peers and send a remote signal to them;
      await Promise.all(
        Array.from(groupStores.values()).map(async (store) => {
          const peerStatuses = get(store.peerStatuses());
          if (peerStatuses) {
            const peersToSendSignal = Object.entries(peerStatuses)
              .filter(
                ([pubkeyB64, status]) =>
                  status.lastSeen > Date.now() - OFFLINE_THRESHOLD &&
                  pubkeyB64 !== encodeHashToBase64(store.groupClient.myPubKey),
              )
              .map(([pubkeyB64, _]) => decodeHashFromBase64(pubkeyB64));

            await store.groupClient.remoteSignalArbitrary(remoteSignalPayload, peersToSendSignal);
          }
        }),
      );
      break;
    }
    case 'create-clone-cell': {
      const appletHash = decodeHashFromBase64(appletId);
      const groupStores = await toPromise(mossStore.groupsForApplet.get(appletHash));
      if (groupStores.size === 0) throw new Error('No group store found.');
      // Install the clone in the group
      const appletClient = await mossStore.getAppClient(appIdFromAppletId(appletId));
      const clonedCell = await appletClient.createCloneCell(message.req);
      // Register the clone in the group dna(s) if it's supposed to be public
      if (message.publicToGroupMembers) {
        await Promise.all(
          Array.from(groupStores.values()).map(async (groupStore) => {
            await groupStore.groupClient.joinClonedCell({
              applet_hash: appletHash,
              dna_hash: clonedCell.cell_id[0],
              role_name: message.req.role_name,
              network_seed: message.req.modifiers.network_seed,
              properties: message.req.modifiers.properties,
              origin_time: message.req.modifiers.origin_time,
              quantum_time: message.req.modifiers.quantum_time,
            });
          }),
        );
      }
      return clonedCell;
    }
    case 'enable-clone-cell': {
      const appletClient = await mossStore.getAppClient(appIdFromAppletId(appletId));
      const clonedCell = await appletClient.enableCloneCell(message.req);
      return clonedCell;
    }
    case 'disable-clone-cell': {
      const appletClient = await mossStore.getAppClient(appIdFromAppletId(appletId));
      return appletClient.disableCloneCell(message.req);
    }
    /**
     * Asset related messages
     */
    case 'asset-to-pocket':
      mossStore.walToPocket(message.wal);
      break;
    case 'drag-asset':
      mossStore.dragWal(message.wal);
      break;
    case 'user-select-asset':
      return openViews.userSelectWal();
    case 'add-tags-to-asset': {
      // We want to make sure that
      const hrl = message.wal.hrl;
      const hrlLocation = await toPromise(mossStore.hrlLocations.get(hrl[0]).get(hrl[1]));
      if (!hrlLocation) throw new Error('Failed to resolve WAL.');
      // Only allow adding to assets from the same applet
      if (encodeHashToBase64(hrlLocation.dnaLocation.appletHash) !== appletId)
        throw new Error('Cannot add tags to an asset that belongs to another Tool.');
      // Add tags to all group stores that the asset belongs to
      const groupStores = await toPromise(
        mossStore.groupsForApplet.get(hrlLocation.dnaLocation.appletHash),
      );
      if (groupStores.size === 0) {
        throw new Error('No associated group found for the provided WAL.');
      }
      return Promise.all(
        Array.from(groupStores.values()).map((groupStore) =>
          groupStore.assetsClient.addTagsToAsset(message.wal, message.tags),
        ),
      );
    }
    case 'remove-tags-from-asset': {
      const hrl = message.wal.hrl;
      const hrlLocation = await toPromise(mossStore.hrlLocations.get(hrl[0]).get(hrl[1]));
      if (!hrlLocation) throw new Error('Failed to resolve WAL.');
      // Only allow removing to assets from the same applet
      if (encodeHashToBase64(hrlLocation.dnaLocation.appletHash) !== appletId)
        throw new Error('Cannot remove tags from an asset that belongs to another Tool.');
      // Add tags to all group stores that the asset belongs to
      const groupStores = await toPromise(
        mossStore.groupsForApplet.get(hrlLocation.dnaLocation.appletHash),
      );
      if (groupStores.size === 0) {
        throw new Error('No associated group found for the provided WAL.');
      }
      return Promise.all(
        Array.from(groupStores.values()).map((groupStore) =>
          groupStore.assetsClient.removeTagsFromAsset(message.wal, message.tags),
        ),
      );
    }
    case 'add-asset-relation': {
      const hrl = message.srcWal.hrl;
      const hrlLocation = await toPromise(mossStore.hrlLocations.get(hrl[0]).get(hrl[1]));
      if (!hrlLocation) throw new Error('Failed to resolve WAL.');
      // Only allow removing to assets from the same applet
      if (encodeHashToBase64(hrlLocation.dnaLocation.appletHash) !== appletId)
        throw new Error('Cannot relation to an asset that belongs to another Tool.');
      // Add tags to all group stores that the asset belongs to
      const groupStores = await toPromise(
        mossStore.groupsForApplet.get(hrlLocation.dnaLocation.appletHash),
      );
      if (groupStores.size === 0) {
        throw new Error('No associated group found for the provided WAL.');
      }
      return Promise.all(
        Array.from(groupStores.values()).map((groupStore) =>
          groupStore.assetsClient.addAssetRelation(message.srcWal, message.dstWal),
        ),
      );
    }
    case 'remove-asset-relation': {
      // Note: We assume here that the asset relation that gets removed lives inside the
      // Tool that requests the removal. If that's not the case it fails. And it probably
      // shouldn't be allowed to remove an asset relation belonging to another Tool anyway
      const groupStores = await toPromise(
        mossStore.groupsForApplet.get(decodeHashFromBase64(appletId)),
      );
      if (groupStores.size === 0) {
        throw new Error('No associated group found for the provided WAL.');
      }
      console.log('### removing asset relation');
      return Promise.all(
        Array.from(groupStores.values()).map((groupStore) =>
          groupStore.assetsClient.removeAssetRelation(message.relationHash),
        ),
      );
    }
    case 'add-tags-to-asset-relation': {
      const groupStores = await toPromise(
        mossStore.groupsForApplet.get(decodeHashFromBase64(appletId)),
      );
      if (groupStores.size === 0) {
        throw new Error('No associated group found for the provided WAL.');
      }
      return Promise.all(
        Array.from(groupStores.values()).map((groupStore) =>
          groupStore.assetsClient.addTagsToAssetRelation(message.relationHash, message.tags),
        ),
      );
    }
    case 'remove-tags-from-asset-relation': {
      const groupStores = await toPromise(
        mossStore.groupsForApplet.get(decodeHashFromBase64(appletId)),
      );
      if (groupStores.size === 0) {
        throw new Error('No associated group found for the provided WAL.');
      }
      return Promise.all(
        Array.from(groupStores.values()).map((groupStore) =>
          groupStore.assetsClient.removeTagsFromAssetRelation(message.relationHash, message.tags),
        ),
      );
    }
    case 'get-all-asset-relation-tags': {
      // Get all tags across all groups
      let groupStores: GroupStore[];
      if (message.crossGroup) {
        const groupStoresMap = await toPromise(mossStore.groupStores);
        groupStores = Array.from(groupStoresMap.values());
      } else {
        const groupStoresMap = await toPromise(
          mossStore.groupsForApplet.get(decodeHashFromBase64(appletId)),
        );
        groupStores = Array.from(groupStoresMap.values());
        if (groupStores.length === 0) {
          throw new Error('No associated group found for the provided WAL.');
        }
      }
      const tags: string[] = [];
      await Promise.all(
        Array.from(groupStores.values()).map(async (store) => {
          const relationTags = await toPromise(store.allAssetRelationTags);
          tags.push(...relationTags);
        }),
      );
      return Array.from(new Set(tags.sort((a, b) => a.localeCompare(b))));
    }
    case 'subscribe-to-asset-store': {
      const hrl = message.wal.hrl;
      const hrlLocation = await toPromise(mossStore.hrlLocations.get(hrl[0]).get(hrl[1]));
      if (!hrlLocation) throw new Error('Failed to resolve WAL.');
      const groupStore = await getFirstGroupStoreForHrl(mossStore, hrlLocation);
      if (!groupStore) {
        throw new Error(
          'Failed to unsubscribe from Asset store: No associated group store found for the provided WAL.',
        );
      }
      groupStore.subscribeToAssetStore(message.wal, [appletId]);
      return;
    }
    case 'unsubscribe-from-asset-store': {
      const hrl = message.wal.hrl;
      const hrlLocation = await toPromise(mossStore.hrlLocations.get(hrl[0]).get(hrl[1]));
      if (!hrlLocation) throw new Error('Failed to resolve WAL.');
      const groupStore = await getFirstGroupStoreForHrl(mossStore, hrlLocation);
      if (!groupStore) {
        throw new Error(
          'Failed to unsubscribe from Asset store: No associated group store found for the provided WAL.',
        );
      }
      groupStore.unsubscribeFromAssetStore(message.wal, appletId);
      return;
    }
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

  async getAppletAssetInfo(wal: WAL, recordInfo?: RecordInfo): Promise<AssetInfo | undefined> {
    return this.postMessage({
      type: 'get-applet-asset-info',
      wal,
      recordInfo,
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

  peerStatusUpdate(payload: PeerStatusUpdate) {
    return this.postMessage({
      type: 'peer-status-update',
      payload,
    });
  }

  async postMessage<T>(message: ParentToAppletMessage) {
    return new Promise<T>((resolve, reject) => {
      const { port1, port2 } = new MessageChannel();

      this.iframe.contentWindow!.postMessage(message, '*', [port2]);

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

async function getFirstGroupStoreForHrl(
  mossStore: MossStore,
  hrlLocation: HrlLocation,
): Promise<GroupStore | undefined> {
  const groupsForApplet = await toPromise(
    mossStore.groupsForApplet.get(hrlLocation.dnaLocation.appletHash),
  );
  if (groupsForApplet.size === 0) {
    return undefined;
  }
  return Array.from(groupsForApplet.values())[0];
}

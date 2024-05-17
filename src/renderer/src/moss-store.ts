import {
  asyncDerived,
  asyncDeriveStore,
  completed,
  lazyLoad,
  mapAndJoin,
  pipe,
  toPromise,
  Readable,
  Writable,
  writable,
  derived,
  manualReloadStore,
  asyncReadable,
} from '@holochain-open-dev/stores';
import {
  DnaHashMap,
  HoloHashMap,
  LazyHoloHashMap,
  LazyMap,
  pickBy,
  slice,
} from '@holochain-open-dev/utils';
import {
  AppAuthenticationToken,
  AppClient,
  AppInfo,
  AppWebsocket,
  InstalledAppId,
  ProvisionedCell,
} from '@holochain/client';
import { encodeHashToBase64 } from '@holochain/client';
import { EntryHashB64 } from '@holochain/client';
import { ActionHash, AdminWebsocket, CellType, DnaHash, EntryHash } from '@holochain/client';
import {
  CreatableResult,
  CreatableName,
  GroupProfile,
  WAL,
  ProfilesLocation,
  CreatableType,
} from '@lightningrodlabs/we-applet';
import { v4 as uuidv4 } from 'uuid';
import { notify } from '@holochain-open-dev/elements';
import { msg } from '@lit/localize';

import { ToolsLibraryStore } from './tools-library/tool-library-store.js';
import { GroupStore } from './groups/group-store.js';
import { DnaLocation, locateHrl } from './processes/hrl/locate-hrl.js';
import { ConductorInfo, getAllAppAssetsInfos, joinGroup } from './electron-api.js';
import {
  appIdFromAppletHash,
  appletHashFromAppId,
  appletIdFromAppId,
  deStringifyWal,
  findAppForDnaHash,
  initAppClient,
  isAppRunning,
  stringifyWal,
  toolBundleActionHashFromDistInfo,
  validateWal,
} from './utils.js';
import { AppletStore } from './applets/applet-store.js';
import {
  AppHashes,
  AppletHash,
  AppletId,
  AppletNotification,
  DistributionInfo,
  WebHappSource,
} from './types.js';
import { Applet } from './types.js';
import { GroupClient } from './groups/group-client.js';
import { Tool, UpdateableEntity } from './tools-library/types.js';
import { fromUint8Array } from 'js-base64';
import { encode } from '@msgpack/msgpack';
import { AssetViewerState, DashboardState } from './elements/main-dashboard.js';
import { PersistedStore } from './persisted-store.js';
import { WeCache } from './cache.js';

export type SearchStatus = 'complete' | 'loading';

export class MossStore {
  constructor(
    public adminWebsocket: AdminWebsocket,
    public conductorInfo: ConductorInfo,
    public toolsLibraryStore: ToolsLibraryStore,
    public isAppletDev: boolean,
    authenticationTokens: Record<InstalledAppId, AppAuthenticationToken>,
  ) {
    this._authenticationTokens = authenticationTokens;
  }

  private _updatableApplets: Writable<Record<AppletId, UpdateableEntity<Tool>>> = writable({});
  private _updatesAvailableByGroup: Writable<DnaHashMap<boolean>> = writable(new DnaHashMap());
  // The dashboardstate must be accessible by the AppletHost, which is why it needs to be tracked
  // here at the MossStore level
  private _dashboardState: Writable<DashboardState> = writable({
    viewType: 'personal',
  });

  private _assetViewerState: Writable<AssetViewerState> = writable({
    position: 'side',
    visible: false,
  });

  persistedStore: PersistedStore = new PersistedStore();

  weCache: WeCache = new WeCache();

  _notificationFeed: Writable<AppletNotification[]> = writable([]);

  /**
   * search filter as well as number of applet hosts from which a response is expected
   */
  _searchParams: [string, number] = ['', 0];

  /**
   * Number of responses that were received for a given set of search parameters
   */
  _searchResponses: number = 0;

  _searchResults: Writable<[string, Array<WAL>, SearchStatus]> = writable(['', [], 'complete']);

  _allCreatableTypes: Writable<Record<AppletId, Record<CreatableName, CreatableType>>> = writable(
    {},
  );

  // Contains a record of CreatableContextRestult ordered by dialog id.
  _creatableDialogResults: Writable<Record<string, CreatableResult>> = writable({});

  _authenticationTokens: Record<InstalledAppId, AppAuthenticationToken> = {};

  _appClients: Record<InstalledAppId, AppClient> = {};

  setCreatableDialogResult(dialogId: string, result: CreatableResult) {
    this._creatableDialogResults.update((store) => {
      store[dialogId] = result;
      return store;
    });
  }

  creatableDialogResult(dialogId: string): Readable<CreatableResult | undefined> {
    return derived(this._creatableDialogResults, (store) => store[dialogId]);
  }

  clearCreatableDialogResult(dialogId): void {
    this._creatableDialogResults.update((store) => {
      delete store[dialogId];
      return store;
    });
  }

  async groupStore(groupDnaHash: DnaHash): Promise<GroupStore | undefined> {
    const groupStores = await toPromise(this.groupStores);
    return groupStores.get(groupDnaHash);
  }

  async checkForUiUpdates() {
    // 1. Get all AppAssetsInfos
    const updatableApplets: Record<AppletId, UpdateableEntity<Tool>> = {}; // Tool entry with the new assets by AppletId
    const appAssetsInfos = await getAllAppAssetsInfos();
    // console.log('@checkForUiUpdates:  appAssetsInfos: ', appAssetsInfos);
    const allLatestToolEntities =
      await this.toolsLibraryStore.toolsLibraryClient.getAllToolEntites();
    // console.log('@checkForUiUpdates:  allAppEntries: ', allAppEntries);

    Object.entries(appAssetsInfos).forEach(([appId, appAssetInfo]) => {
      if (
        appAssetInfo.distributionInfo.type === 'tools-library' &&
        appAssetInfo.type === 'webhapp' &&
        appAssetInfo.sha256
      ) {
        const orignalToolActionHash = appAssetInfo.distributionInfo.info.originalToolActionHash;
        const maybeRelevantToolEntity = allLatestToolEntities.find(
          (toolEntity) =>
            encodeHashToBase64(toolEntity.originalActionHash) === orignalToolActionHash,
        );
        if (maybeRelevantToolEntity) {
          const appHashes: AppHashes = JSON.parse(maybeRelevantToolEntity.record.entry.hashes);
          // Check that happ hash is the same but webhapp hash is different
          if (appHashes.type === 'webhapp') {
            if (
              appHashes.happ.sha256 === appAssetInfo.happ.sha256 &&
              appHashes.sha256 !== appAssetInfo.sha256
            ) {
              const appletId = appletIdFromAppId(appId);
              updatableApplets[appletId] = maybeRelevantToolEntity;
            }
          }
        }
      }
    });

    // console.log('@checkForUiUpdates:  updatableApplets: ', updatableApplets);
    this._updatableApplets.set(updatableApplets);

    const updatesAvailableByGroup = new DnaHashMap<boolean>();
    const groupStores = await toPromise(this.groupStores);
    await Promise.all(
      Array.from(groupStores.entries()).map(async ([dnaHash, groupStore]) => {
        const runningGroupApplets = await toPromise(groupStore.allMyRunningApplets);
        const runningGroupAppletsB64 = runningGroupApplets.map((hash) => encodeHashToBase64(hash));
        let updateAvailable = false;
        Object.keys(updatableApplets).forEach((appletId) => {
          if (runningGroupAppletsB64.includes(appletId)) {
            updateAvailable = true;
          }
        });
        updatesAvailableByGroup.set(dnaHash, updateAvailable);
      }),
    );
    this._updatesAvailableByGroup.set(updatesAvailableByGroup);
  }

  updatableApplets(): Readable<Record<AppletId, UpdateableEntity<Tool>>> {
    return derived(this._updatableApplets, (store) => store);
  }

  updatesAvailableForGroup(groupDnaHash: DnaHash): Readable<boolean> {
    return derived(this._updatesAvailableByGroup, (store) => store.get(groupDnaHash));
  }

  appletUpdatable(appletHash: AppletHash): Readable<boolean> {
    return derived(this._updatableApplets, (store) =>
      Object.keys(store).includes(encodeHashToBase64(appletHash)),
    );
  }

  dashboardState(): Readable<DashboardState> {
    return derived(this._dashboardState, (state) => state);
  }

  setDashboardState(dashboardState: DashboardState) {
    this._dashboardState.set(dashboardState);
  }

  assetViewerState(): Readable<AssetViewerState> {
    return derived(this._assetViewerState, (state) => state);
  }

  setAssetViewerState(state: AssetViewerState) {
    this._assetViewerState.set(state);
  }

  notificationFeed(): Readable<AppletNotification[]> {
    return derived(this._notificationFeed, (store) => store);
  }

  updateNotificationFeed(appletId: AppletId, daysSinceEpoch: number) {
    this._notificationFeed.update((store) => {
      // console.log('store: ', store);
      const allNotificationStrings = store.map((nots) => JSON.stringify(nots));
      const updatedAppletNotifications: string[] = this.persistedStore.appletNotifications
        .value(appletId, daysSinceEpoch)
        .map((notification) => JSON.stringify({ appletId, notification }));
      // console.log('updatedAppletNotifications: ', updatedAppletNotifications);
      // console.log('SET: ', new Set([...store, ...updatedAppletNotifications]));
      const updatedNotifications: string[] = [
        ...new Set([...allNotificationStrings, ...updatedAppletNotifications]),
      ];
      // console.log('updatedNotifications: ', updatedNotifications);
      return updatedNotifications
        .map((notificationsString) => JSON.parse(notificationsString))
        .sort(
          (appletNotification_a, appletNotification_b) =>
            appletNotification_b.notification.timestamp -
            appletNotification_a.notification.timestamp,
        );
    });
  }

  updateSearchParams(filter: string, waitingForNHosts: number) {
    this._searchParams = [filter, waitingForNHosts];
    this._searchResponses = 0;
  }

  updateSearchResults(filter: string, results: WAL[], fromCache: boolean) {
    if (!fromCache) this._searchResponses += 1;
    const searchStatus = this._searchResponses === this._searchParams[1] ? 'complete' : 'loading';
    this._searchResults.update((store) => {
      if (this._searchParams[0] !== store[0] || this._searchParams[0] === '') {
        return [filter, results, searchStatus];
      } else if (this._searchParams[0] === filter) {
        const deduplicatedResults = Array.from(
          new Set([...store[1], ...results].map((wal) => stringifyWal(wal))),
        ).map((stringifiedHrl) => deStringifyWal(stringifiedHrl));
        return [filter, deduplicatedResults, searchStatus];
      }
      return store;
    });
  }

  clearSearchResults() {
    this._searchResults.set(['', [], 'complete']);
  }

  searchResults(): Readable<[WAL[], SearchStatus]> {
    return derived(this._searchResults, (store) => [store[1], store[2]]) as any;
  }

  updateCreatableTypes(appletId: AppletId, creatableTypes: Record<CreatableName, CreatableType>) {
    this._allCreatableTypes.update((store) => {
      store[appletId] = creatableTypes;
      return store;
    });
  }

  /**
   * Clones the group DNA with a new unique network seed, and creates a group info entry in that DNA
   */
  public async createGroup(name: string, logo: string): Promise<AppInfo> {
    if (!logo) throw new Error('No logo provided.');

    // generate random network seed (maybe use random words instead later, e.g. https://www.npmjs.com/package/generate-passphrase)
    const networkSeed = uuidv4();

    const appInfo = await this.joinGroup(networkSeed); // this line also updates the matrix store

    const groupDnaHash: DnaHash = appInfo.cell_info['group'][0][CellType.Provisioned].cell_id[0];

    const groupStore = await this.groupStore(groupDnaHash);

    try {
      if (!groupStore) throw new Error('GroupStore still undefined after joining group.');

      const groupProfile: GroupProfile = {
        logo_src: logo,
        name,
      };
      await groupStore.groupClient.setGroupProfile(groupProfile);
    } catch (e) {
      try {
        await this.leaveGroup(groupDnaHash);
        console.error(`Failed to set up group profile - left group again: ${e}`);
      } catch (err) {
        throw new Error(`Failed to leave group after failed profile creation: ${err}`);
      }
    }

    await this.reloadManualStores();
    return appInfo;
  }

  public async joinGroup(networkSeed: string): Promise<AppInfo> {
    try {
      const appInfo = await joinGroup(networkSeed);
      await this.reloadManualStores();
      return appInfo;
    } catch (e) {
      console.error('Error installing group app: ', e);
      return Promise.reject(new Error(`Failed to install group app: ${e}`));
    }
  }

  /**
   * Uninstalls the group DNA and all Applet DNA's that have been installed
   * only in this group
   *
   * @param groupDnaHash
   */
  public async leaveGroup(groupDnaHash: DnaHash) {
    // To cover the case where a Group app may be disable, we do the following:
    // 1. enable the Group DNA to make sure it's running
    // 2. load the GroupStores to make sure the GroupStore for that Group is available
    const allApps = await this.adminWebsocket.listApps({});
    const groupApps = allApps.filter((app) => app.installed_app_id.startsWith('group#'));

    const appToLeave = groupApps.find(
      (app) =>
        app.cell_info['group'][0][CellType.Provisioned].cell_id[0].toString() ===
        groupDnaHash.toString(),
    );

    if (!appToLeave) throw new Error('Group with this DNA hash not found in the conductor.');

    await this.adminWebsocket.enableApp({
      installed_app_id: appToLeave.installed_app_id,
    });
    await this.reloadManualStores();

    const groupStore = await this.groupStore(groupDnaHash);

    if (!groupStore)
      throw new Error(
        'GroupStore not found even after enabling Group app and reloading GroupStores.',
      );

    // We get all Applets here already before we uninstall anything, in case it fails.
    const applets = await groupStore.groupClient.getMyAppletsHashes();

    await this.adminWebsocket.uninstallApp({
      installed_app_id: appToLeave.installed_app_id,
    });

    await Promise.all(
      applets.map(async (appletHash) => {
        // TODO: Is this save? groupsForApplet depends on the network so it may not always
        // actually return all groups that depend on this applet
        const groupsForApplet = await this.getGroupsForApplet(appletHash);

        // console.warn(`@leaveGroup: found groups for applet ${encodeHashToBase64(appletHash)}: ${groupsForApplet.map(hash => encodeHashToBase64(hash))}`);

        if (groupsForApplet.length === 0) {
          // console.warn("@leaveGroup: Uninstalling applet with app id: ", encodeHashToBase64(appletHash));
          await this.adminWebsocket.uninstallApp({
            installed_app_id: appIdFromAppletHash(appletHash),
          });
          const backgroundIframe = document.getElementById(encodeHashToBase64(appletHash)) as
            | HTMLIFrameElement
            | undefined;
          if (backgroundIframe) {
            backgroundIframe.remove();
          }
        }
      }),
    );

    await this.reloadManualStores();
  }

  groupStores = manualReloadStore(async () => {
    const groupStores = new DnaHashMap<GroupStore>();
    const apps = await this.adminWebsocket.listApps({});
    console.log(
      'APPS: ',
      apps.filter((app) => app.installed_app_id.startsWith('group#')),
    );
    console.log(
      'APPS STATUS: ',
      apps.filter((app) => app.installed_app_id.startsWith('group#')).map((info) => info.status),
    );
    const runningGroupsApps = apps
      .filter((app) => app.installed_app_id.startsWith('group#'))
      .filter((app) => isAppRunning(app));

    console.log('RUNNING GROUP APPS: ', runningGroupsApps);
    await Promise.all(
      runningGroupsApps.map(async (app) => {
        const groupDnaHash = app.cell_info['group'][0][CellType.Provisioned].cell_id[0];

        const token = await this.getAuthenticationToken(app.installed_app_id);
        const groupAppWebsocket = await initAppClient(token);

        groupStores.set(groupDnaHash, new GroupStore(groupAppWebsocket, token, groupDnaHash, this));
      }),
    );

    return groupStores;
  });

  installedApps = manualReloadStore(async () => this.adminWebsocket.listApps({}));

  runningApps = asyncDerived(this.installedApps, (apps) => apps.filter((app) => isAppRunning(app)));

  installedApplets = asyncDerived(this.installedApps, async (apps) =>
    apps
      .filter((app) => app.installed_app_id.startsWith('applet#'))
      .map((app) => appletHashFromAppId(app.installed_app_id)),
  );

  runningApplets = asyncDerived(this.runningApps, async (apps) =>
    apps
      .filter((app) => app.installed_app_id.startsWith('applet#'))
      .map((app) => appletHashFromAppId(app.installed_app_id)),
  );

  runningGroupsApps = asyncDerived(this.runningApps, (apps) =>
    apps.filter((app) => app.installed_app_id.startsWith('group#')),
  );

  groupsDnaHashes = asyncDerived(this.runningGroupsApps, (apps) => {
    const groupApps = apps.filter((app) => app.installed_app_id.startsWith('group#'));

    const groupsDnaHashes = groupApps.map((app) => {
      const cell = app.cell_info['group'][0][CellType.Provisioned] as ProvisionedCell;
      return cell.cell_id[0];
    });
    return groupsDnaHashes;
  });

  appletStores = new LazyHoloHashMap((appletHash: EntryHash) =>
    asyncReadable<AppletStore>(async (set) => {
      // console.log("@appletStores: attempting to get AppletStore for applet with hash: ", encodeHashToBase64(appletHash));
      const groups = await toPromise(this.groupsForApplet.get(appletHash));
      // console.log(
      //   '@appletStores: groups: ',
      //   Array.from(groups.keys()).map((hash) => encodeHashToBase64(hash)),
      // );

      if (groups.size === 0) throw new Error('Applet is not installed in any of the groups');

      const applet = await Promise.race(
        Array.from(groups.values()).map((groupStore) =>
          toPromise(groupStore.applets.get(appletHash)),
        ),
      );

      if (!applet) throw new Error('Applet not found yet');

      const token = await this.getAuthenticationToken(appIdFromAppletHash(appletHash));

      set(
        new AppletStore(
          appletHash,
          applet,
          this.conductorInfo,
          token,
          this.toolsLibraryStore,
          this.isAppletDev,
        ),
      );
    }),
  );

  allCreatableTypes(): Readable<Record<AppletId, Record<CreatableName, CreatableType>>> {
    return derived(this._allCreatableTypes, (store) => store);
  }

  allRunningApplets = pipe(this.runningApplets, async (appletsHashes) => {
    // sliceAndJoin won't work here in case appletStores.get() returns an error
    // because an applet is installed in the conductor but not part of any of the groups
    const runningAppletStores = new HoloHashMap<AppletHash, AppletStore>();
    for (const hash of appletsHashes) {
      try {
        const appletStore = await toPromise(this.appletStores.get(hash));
        runningAppletStores.set(hash, appletStore);
      } catch (e) {
        console.warn(
          `Failed to get AppletStore for applet with hash ${encodeHashToBase64(hash)}: ${e}`,
        );
      }
    }
    return runningAppletStores;
  });

  allGroupsProfiles = asyncDeriveStore(this.groupStores, (stores) =>
    mapAndJoin(stores, (store) => store.groupProfile),
  );

  /**
   * A reliable function to get the groups for an applet and is guaranteed
   * to reflect the current state.
   */
  getGroupsForApplet = async (appletHash: AppletHash) => {
    const allApps = await this.adminWebsocket.listApps({});
    const groupApps = allApps.filter((app) => app.installed_app_id.startsWith('group#'));
    const groupsWithApplet: Array<DnaHash> = [];
    await Promise.all(
      groupApps.map(async (app) => {
        const token = await this.getAuthenticationToken(app.installed_app_id);
        const groupAppWebsocket = await initAppClient(token);
        const groupDnaHash: DnaHash = app.cell_info['group'][0][CellType.Provisioned].cell_id[0];
        const groupClient = new GroupClient(groupAppWebsocket, token, 'group');
        const allMyAppletDatas = await groupClient.getMyAppletsHashes();
        if (allMyAppletDatas.map((hash) => hash.toString()).includes(appletHash.toString())) {
          groupsWithApplet.push(groupDnaHash);
        }
      }),
    );
    return groupsWithApplet;
  };

  groupsForApplet = new LazyHoloHashMap((appletHash: EntryHash) =>
    pipe(
      this.groupStores,
      (allGroups) => mapAndJoin(allGroups, (store) => store.allMyApplets),
      async (appletsByGroup) => {
        // console.log(
        //   'appletsByGroup: ',
        //   Array.from(appletsByGroup.values()).map((hashes) =>
        //     hashes.map((hash) => encodeHashToBase64(hash)),
        //   ),
        // );
        const groupDnaHashes = Array.from(appletsByGroup.entries())
          .filter(([_groupDnaHash, appletsHashes]) =>
            appletsHashes.find((hash) => hash.toString() === appletHash.toString()),
          )
          .map(([groupDnaHash, _]) => groupDnaHash);

        // console.log('Requested applet hash: ', encodeHashToBase64(appletHash));
        // console.log('groupDnaHashes: ', groupDnaHashes);

        const groupStores = await toPromise(this.groupStores);

        // console.log(
        //   'GROUPSTORES HASHES: ',
        //   Array.from(groupStores.keys()).map((hash) => encodeHashToBase64(hash)),
        // );

        // console.log(
        //   'Sliced group stores: ',
        //   Array.from(slice(groupStores, groupDnaHashes).keys()).map((hash) =>
        //     encodeHashToBase64(hash),
        //   ),
        // );

        return slice(groupStores, groupDnaHashes);
      },
    ),
  );

  dnaLocations = new LazyHoloHashMap((dnaHash: DnaHash) =>
    asyncDerived(this.installedApps, async (installedApps) => {
      const app = findAppForDnaHash(installedApps, dnaHash);

      if (!app) throw new Error('The given dna is not installed');
      if (!app.appInfo.installed_app_id.startsWith('applet#'))
        throw new Error("The given dna is part of an app that's not an applet.");

      return {
        appletHash: appletHashFromAppId(app.appInfo.installed_app_id),
        appInfo: app.appInfo,
        roleName: app.roleName,
      } as DnaLocation;
    }),
  );

  hrlLocations = new LazyHoloHashMap(
    (dnaHash: DnaHash) =>
      new LazyHoloHashMap((hash: EntryHash | ActionHash) => {
        return asyncDerived(this.dnaLocations.get(dnaHash), async (dnaLocation: DnaLocation) => {
          const appToken = await this.getAuthenticationToken(dnaLocation.appInfo.installed_app_id);
          const appClient = await initAppClient(appToken);
          const entryDefLocation = await locateHrl(this.adminWebsocket, appClient, dnaLocation, [
            dnaHash,
            hash,
          ]);
          if (!entryDefLocation) return undefined;

          return {
            dnaLocation,
            entryDefLocation,
          };
        });
      }),
  );

  assetInfo = new LazyMap((walStringified: string) => {
    const wal = deStringifyWal(walStringified);
    return pipe(this.hrlLocations.get(wal.hrl[0]).get(wal.hrl[1]), (location) =>
      location
        ? pipe(
            this.appletStores.get(location.dnaLocation.appletHash),
            (appletStore) => appletStore!.host,
            (host) =>
              lazyLoad(() =>
                host
                  ? host.getAppletAssetInfo(
                      location.dnaLocation.roleName,
                      location.entryDefLocation.integrity_zome,
                      location.entryDefLocation.entry_def,
                      wal,
                    )
                  : Promise.resolve(undefined),
              ),
          )
        : completed(undefined),
    );
  });

  appletsForBundleHash = new LazyHoloHashMap(
    (
      toolBundleHash: ActionHash, // action hash of the Tool entry in the tools library
    ) =>
      pipe(
        this.allRunningApplets,
        (runningApplets) =>
          completed(
            pickBy(
              runningApplets,
              (appletStore) =>
                toolBundleActionHashFromDistInfo(
                  appletStore.applet.distribution_info,
                ).toString() === toolBundleHash.toString(),
            ),
          ),
        (appletsForThisBundleHash) =>
          mapAndJoin(appletsForThisBundleHash, (_, appletHash) =>
            this.groupsForApplet.get(appletHash),
          ),
        async (groupsByApplets) => {
          const appletsB64: Record<EntryHashB64, [AppAuthenticationToken, ProfilesLocation]> = {};

          for (const [appletHash, groups] of Array.from(groupsByApplets.entries())) {
            const appletToken = await this.getAuthenticationToken(appIdFromAppletHash(appletHash));
            if (groups.size > 0) {
              const firstGroupToken = Array.from(groups.values())[0].groupClient
                .authenticationToken;
              appletsB64[encodeHashToBase64(appletHash)] = [
                appletToken,
                {
                  authenticationToken: firstGroupToken,
                  profilesRoleName: 'group',
                },
              ];
            }
          }
          return appletsB64;
        },
      ),
  );

  allAppletsHosts = pipe(this.allRunningApplets, (applets) =>
    mapAndJoin(applets, (appletStore) => appletStore.host),
  );

  async installApplet(appletHash: EntryHash, applet: Applet): Promise<AppInfo> {
    console.log('Installing applet with hash: ', encodeHashToBase64(appletHash));
    const appId = appIdFromAppletHash(appletHash);
    if (!applet.network_seed) {
      throw new Error(
        'Network Seed not defined. Undefined network seed is currently not supported.',
      );
    }

    const toolEntity = await this.toolsLibraryStore.getLatestToolEntry(
      toolBundleActionHashFromDistInfo(applet.distribution_info),
    );

    console.log('@installApplet: got ToolEntry: ', toolEntity.record.entry);
    console.log('@installApplet: got Applet: ', applet);

    if (!toolEntity) throw new Error('ToolEntry not found in Tools Library');

    const source: WebHappSource = JSON.parse(toolEntity.record.entry.source);
    if (source.type !== 'https') throw new Error(`Unsupported applet source type '${source.type}'`);
    if (!(source.url.startsWith('https://') || source.url.startsWith('file://')))
      throw new Error(`Invalid applet source URL '${source.url}'`);

    const distributionInfo: DistributionInfo = JSON.parse(applet.distribution_info);

    const appInfo = await window.electronAPI.installAppletBundle(
      appId,
      applet.network_seed!,
      {},
      encodeHashToBase64(this.toolsLibraryStore.toolsLibraryClient.client.myPubKey),
      source.url,
      distributionInfo,
      applet.sha256_happ,
      applet.sha256_ui,
      applet.sha256_webhapp,
      toolEntity.record.entry.meta_data,
    );

    return appInfo;
  }

  async uninstallApplet(appletHash: EntryHash): Promise<void> {
    // console.warn("@we-store: Uninstalling applet.");
    await this.adminWebsocket.uninstallApp({
      installed_app_id: appIdFromAppletHash(appletHash),
    });
    const iframe = document.getElementById(encodeHashToBase64(appletHash)) as
      | HTMLIFrameElement
      | undefined;
    if (iframe) {
      // console.warn("Got iframe with id. Removing it from DOM.");
      iframe.remove();
    }
    await this.reloadManualStores();
  }

  async disableApplet(appletHash: EntryHash) {
    const installed = await toPromise(this.isInstalled.get(appletHash));
    if (!installed) return;

    await this.adminWebsocket.disableApp({
      installed_app_id: appIdFromAppletHash(appletHash),
    });
    await this.reloadManualStores();
  }

  async enableApplet(appletHash: EntryHash) {
    const installed = await toPromise(this.isInstalled.get(appletHash));
    if (!installed) return;

    await this.adminWebsocket.enableApp({
      installed_app_id: appIdFromAppletHash(appletHash),
    });
    await this.reloadManualStores();
  }

  async reloadManualStores() {
    await this.groupStores.reload();
    // const groupStores = await toPromise(this.groupStores);
    // await Promise.all(
    //   Array.from(groupStores.values()).map(async (store) => {
    //     await store.allMyApplets.reload();
    //     await store.allMyRunningApplets.reload();
    //   }),
    // );
    await this.installedApps.reload();
  }

  isInstalled = new LazyHoloHashMap((appletHash: EntryHash) => {
    this.installedApps.reload(); // required after fresh installation of app
    return asyncDerived(
      this.installedApplets,
      (appletsHashes) => !!appletsHashes.find((hash) => hash.toString() === appletHash.toString()),
    );
  });

  isRunning = new LazyHoloHashMap((appletHash: EntryHash) =>
    asyncDerived(
      this.runningApplets,
      (appletsHashes) => !!appletsHashes.find((hash) => hash.toString() === appletHash.toString()),
    ),
  );

  walToPocket(wal: WAL) {
    wal = validateWal(wal);
    const pocketContent = this.persistedStore.pocket.value();
    const walStringified = fromUint8Array(encode(wal));
    // Only add if it's not already there
    if (
      pocketContent.filter((walStringifiedStored) => walStringifiedStored === walStringified)
        .length === 0
    ) {
      pocketContent.push(walStringified);
    }
    this.persistedStore.pocket.set(pocketContent);
    notify(msg('Added to Pocket.'));
    document.dispatchEvent(new CustomEvent('added-to-pocket'));
  }

  clearPocket() {
    this.persistedStore.pocket.set([]);
    notify(msg('Pocket cleared.'));
    document.dispatchEvent(new CustomEvent('pocket-cleared'));
  }

  walToRecentlyCreated(wal: WAL) {
    wal = validateWal(wal);
    let recentlyCreatedContent = this.persistedStore.recentlyCreated.value();
    const walStringified = fromUint8Array(encode(wal));
    // Only add if it's not already there
    if (
      recentlyCreatedContent.filter(
        (walStringifiedStored) => walStringifiedStored === walStringified,
      ).length === 0
    ) {
      recentlyCreatedContent.push(walStringified);
    }
    // keep the 8 latest created items only
    recentlyCreatedContent = recentlyCreatedContent.slice(0, 8);
    this.persistedStore.recentlyCreated.set(recentlyCreatedContent);
  }

  removeWalFromPocket(wal: WAL) {
    const pocketContent = this.persistedStore.pocket.value();
    const walStringified = fromUint8Array(encode(wal));
    const newClipboardContent = pocketContent.filter(
      (walStringifiedStored) => walStringifiedStored !== walStringified,
    );
    this.persistedStore.pocket.set(newClipboardContent);
  }

  async search(filter: string) {
    const hosts = await toPromise(this.allAppletsHosts);

    const hostsArray = Array.from(hosts.entries());
    this.updateSearchParams(filter, hostsArray.length);

    // In setTimeout, store results to cache and update searchResults store in mossStore if latest search filter
    // is still the same

    const promises: Array<Promise<void>> = [];

    // TODO fix case where applet host failed to initialize
    for (const [appletHash, host] of hostsArray) {
      promises.push(
        (async () => {
          const cachedResults = this.weCache.searchResults.value(appletHash, filter);
          if (cachedResults) {
            this.updateSearchResults(filter, cachedResults, true);
          }
          try {
            // console.log(`searching for host ${host?.appletId}...`);
            const results = host ? await host.search(filter) : [];
            this.updateSearchResults(filter, results, false);

            // Cache results here for an applet/filter pair.
            this.weCache.searchResults.set(results, appletHash, filter);
            // console.log(`Got results for host ${host?.appletId}: ${JSON.stringify(results)}`);
            // return results;
          } catch (e) {
            console.warn(`Search in applet ${host?.appletId} failed: ${e}`);
            // Update search results to allow for reaching 'complete' state
            this.updateSearchResults(filter, [], false);
          }
        })(),
      );
    }

    // Do this async and return function immediately.
    setTimeout(async () => await Promise.all(promises));
  }

  async getAuthenticationToken(appId: InstalledAppId): Promise<AppAuthenticationToken> {
    let token = this._authenticationTokens[appId];
    if (!token) {
      token = (
        await this.adminWebsocket.issueAppAuthenticationToken({
          installed_app_id: appId,
          single_use: false,
          expiry_seconds: 99999999,
        })
      ).token;
      this._authenticationTokens[appId] = token;
    }
    return token;
  }

  async getAppClient(appId: InstalledAppId): Promise<AppClient> {
    let appClient = this._appClients[appId];
    if (appClient) return appClient;
    const token = await this.getAuthenticationToken(appId);
    return AppWebsocket.connect({
      token,
    });
  }
}

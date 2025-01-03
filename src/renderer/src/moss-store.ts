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
  AgentPubKeyB64,
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
  WAL,
  ProfilesLocation,
  CreatableType,
  NULL_HASH,
  AppletHash,
  AppletId,
  stringifyWal,
  deStringifyWal,
  ParentToAppletMessage,
} from '@theweave/api';
import { GroupStore } from './groups/group-store.js';
import { DnaLocation, HrlLocation, locateHrl } from './processes/hrl/locate-hrl.js';
import {
  ConductorInfo,
  createGroup,
  getAllAppAssetsInfos,
  getAppletDevPort,
  getToolIcon,
  joinGroup,
} from './electron-api.js';
import {
  destringifyAndDecode,
  devModeToolLibraryFromDevConfig,
  encodeAndStringify,
  findAppForDnaHash,
  initAppClient,
  isAppDisabled,
  isAppRunning,
  postMessageToAppletIframes,
  validateWal,
} from './utils.js';
import { AppletStore } from './applets/applet-store.js';
import {
  AppHashes,
  DeveloperCollecive,
  DeveloperCollectiveToolList,
  DistributionInfo,
  ResourceLocation,
  TDistributionInfo,
  ToolCompatibilityId,
  ToolInfoAndVersions,
  WeaveDevConfig,
} from '@theweave/moss-types';
import {
  appIdFromAppletHash,
  appIdFromAppletId,
  appletHashFromAppId,
  appletIdFromAppId,
  deriveToolCompatibilityId,
  getLatestVersionFromToolInfo,
  toolCompatibilityIdFromDistInfo,
  toolCompatibilityIdFromDistInfoString,
} from '@theweave/utils';
import { Value } from '@sinclair/typebox/value';
import { AppletNotification, ToolAndCurationInfo, ToolInfoAndLatestVersion } from './types.js';
import { GroupClient, GroupProfile, Applet, AssetsClient } from '@theweave/group-client';
import { fromUint8Array } from 'js-base64';
import { encode } from '@msgpack/msgpack';
import { AssetViewerState, DashboardState } from './elements/main-dashboard.js';
import { PersistedStore } from './persisted-store.js';
import { WeCache } from './cache.js';
import { compareVersions } from 'compare-versions';

export type SearchStatus = 'complete' | 'loading';

export type WalInPocket = {
  addedAt: number;
  wal: string;
};

export type DevModeToolLibrary = {
  tools: ToolAndCurationInfo[];
  devCollective: DeveloperCollecive;
};

export class MossStore {
  public isAppletDev: boolean;
  public devModeToolLibrary: DevModeToolLibrary | undefined;

  constructor(
    public adminWebsocket: AdminWebsocket,
    public conductorInfo: ConductorInfo,
    // public toolsLibraryStore: ToolsLibraryStore,
    public appletDevConfig: WeaveDevConfig | undefined,
  ) {
    this.myLatestActivity = Date.now();
    this._version = conductorInfo.moss_version;
    this.isAppletDev = !!appletDevConfig;
    if (appletDevConfig) this.devModeToolLibrary = devModeToolLibraryFromDevConfig(appletDevConfig);
  }

  private _availableToolUpdates: Writable<Record<ToolCompatibilityId, ToolInfoAndLatestVersion>> =
    writable({});

  // The dashboardstate must be accessible by the AppletHost, which is why it needs to be tracked
  // here at the MossStore level
  private _dashboardState: Writable<DashboardState> = writable({
    viewType: 'personal',
    viewState: {
      type: 'moss',
      name: 'welcome',
    },
  });

  private _assetViewerState: Writable<AssetViewerState> = writable({
    position: 'side',
    visible: false,
  });

  persistedStore: PersistedStore = new PersistedStore();

  weCache: WeCache = new WeCache();

  _version: string;

  get version() {
    return this._version;
  }

  _notificationFeed: Writable<AppletNotification[]> = writable([]);

  /**
   * search filter as well as number of applet hosts from which a response is expected
   */
  _searchParams: [string, number] = ['', 0];

  /**
   * Number of responses that were received for a given set of search parameters
   */
  _searchResponses: [string, number] = ['', 0];

  _searchResults: Writable<[string, Array<WAL>, SearchStatus]> = writable(['', [], 'complete']);

  _allCreatableTypes: Writable<Record<AppletId, Record<CreatableName, CreatableType>>> = writable(
    {},
  );

  _dragWal: Writable<WAL | undefined> = writable(undefined);

  _addedToPocket: Writable<boolean> = writable(false);

  // Contains a record of CreatableContextRestult ordered by dialog id.
  _creatableDialogResults: Writable<Record<string, CreatableResult>> = writable({});

  _authenticationTokens: Record<InstalledAppId, AppAuthenticationToken> = {};

  _appClients: Record<InstalledAppId, AppClient> = {};

  /**
   * Ports of applets running with hot-reloading in dev mode
   */
  _appletDevPorts: Record<AppletId, number> = {};

  _toolIcons: Record<ToolCompatibilityId, string> = {};

  _toolInfoRemoteCache: Record<ToolCompatibilityId, ToolInfoAndVersions> = {};

  _tzUtcOffset: number | undefined;

  myLatestActivity: number;

  async toolInfoFromRemote(
    toolListUrl: string,
    toolId: string,
    versionBranch: string,
    noCache = false,
  ): Promise<ToolInfoAndVersions | undefined> {
    const toolCompatibilityId = deriveToolCompatibilityId({
      toolListUrl,
      toolId,
      versionBranch,
    });
    // If it's a Tool from the dev config, take it from the dev mode tool library
    if (this.devModeToolLibrary && toolListUrl.startsWith('###DEVCONFIG###')) {
      return this.devModeToolLibrary.tools.find(
        (tool) => tool.toolCompatibilityId === toolCompatibilityId,
      )?.toolInfoAndVersions;
    }
    const maybeCachedInfo = this._toolInfoRemoteCache[toolCompatibilityId];
    if (!noCache && maybeCachedInfo) return maybeCachedInfo;
    // Fetch latest version of the Tool
    try {
      const resp = await fetch(toolListUrl, { cache: 'no-cache' });
      const toolList: DeveloperCollectiveToolList = await resp.json();
      const toolInfo = toolList.tools.find(
        (tool) => tool.id === toolId && tool.versionBranch === versionBranch,
      );
      if (toolInfo) this._toolInfoRemoteCache[toolCompatibilityId] = toolInfo;
      return toolInfo;
    } catch (e) {
      throw new Error(`Failed to fetch or parse Tool info: ${e}`);
    }
  }

  /**
   *
   * @param toolId
   * @param toolName If provided and in devmode, the tool is picked from the dev config
   * @returns
   */
  async toolIcon(toolId: ToolCompatibilityId, toolName?: string): Promise<string | undefined> {
    let toolIcon: string | undefined = this._toolIcons[toolId];
    if (toolIcon) return toolIcon;
    let resourceLocation: ResourceLocation | undefined;
    if (toolName && this.appletDevConfig) {
      const appletConfig = this.appletDevConfig.applets.find(
        (appletConfig) => appletConfig.name === toolName,
      );
      if (appletConfig) {
        resourceLocation = appletConfig.icon;
      }
    }
    toolIcon = await getToolIcon(toolId, resourceLocation);
    if (toolIcon) this._toolIcons[toolId] = toolIcon;
    return toolIcon;
  }

  dragWal(wal: WAL) {
    this._dragWal.set(wal);
  }

  draggedWal(): Readable<WAL | undefined> {
    return derived(this._dragWal, (store) => store);
  }

  clearDraggedWal() {
    this._dragWal.set(undefined);
  }

  addedToPocket() {
    return derived(this._addedToPocket, (store) => store);
  }

  tzUtcOffset(): number {
    return this._tzUtcOffset ? this._tzUtcOffset : new Date().getTimezoneOffset();
  }

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

  async getAppletDevPort(appletId: AppletId) {
    const maybePort = this._appletDevPorts[appletId];
    if (maybePort) return maybePort;
    const port = await getAppletDevPort(appIdFromAppletId(appletId));
    const appletPorts = this._appletDevPorts;
    appletPorts[appletId] = port;
    this._appletDevPorts = appletPorts;
    return port;
  }

  async groupStore(groupDnaHash: DnaHash): Promise<GroupStore | undefined> {
    const groupStores = await toPromise(this.groupStores);
    return groupStores.get(groupDnaHash);
  }

  async checkForUiUpdates() {
    console.log('Checking for UI updates...');
    // 1. Get all AppAssetsInfos
    const toolsWithAvailableUpdates: Record<ToolCompatibilityId, ToolInfoAndLatestVersion> = {};
    const appAssetsInfos = await getAllAppAssetsInfos();
    // 2. For each Tool class, fetch the latest info from the associated Tool list
    await Promise.allSettled(
      Object.values(appAssetsInfos).map(async ([appAssetInfo, _weaveConfig]) => {
        if (
          appAssetInfo.distributionInfo.type === 'web2-tool-list' &&
          appAssetInfo.type === 'webhapp' &&
          appAssetInfo.sha256
        ) {
          const toolCompatibilityId = appAssetInfo.distributionInfo.info.toolCompatibilityId;
          const toolListUrl = appAssetInfo.distributionInfo.info.toolListUrl;
          // Only fetch once for each Tool class
          if (
            !toolsWithAvailableUpdates[toolCompatibilityId] &&
            !toolListUrl.startsWith('###DEVCONFIG###')
          ) {
            try {
              const toolInfo = await this.toolInfoFromRemote(
                toolListUrl,
                appAssetInfo.distributionInfo.info.toolId,
                appAssetInfo.distributionInfo.info.versionBranch,
                true,
              );
              if (toolInfo) {
                const latestVersion = getLatestVersionFromToolInfo(
                  toolInfo,
                  appAssetInfo.happ.sha256,
                );
                if (latestVersion) {
                  if (
                    compareVersions(
                      latestVersion.version,
                      appAssetInfo.distributionInfo.info.toolVersion,
                    ) === 1
                  ) {
                    toolsWithAvailableUpdates[toolCompatibilityId] = {
                      toolInfo,
                      latestVersion,
                      distributionInfo: {
                        type: 'web2-tool-list',
                        info: {
                          toolListUrl: appAssetInfo.distributionInfo.info.toolListUrl,
                          developerCollectiveId:
                            appAssetInfo.distributionInfo.info.developerCollectiveId,
                          toolId: appAssetInfo.distributionInfo.info.toolId,
                          toolName: toolInfo.title,
                          versionBranch: appAssetInfo.distributionInfo.info.versionBranch,
                          toolVersion: latestVersion.version,
                          toolCompatibilityId:
                            appAssetInfo.distributionInfo.info.toolCompatibilityId,
                        },
                      },
                    };
                  }
                }
              }
            } catch (e) {
              console.warn('Failed to check for UI update: ', e);
            }
          }
        }
      }),
    );

    this._availableToolUpdates.set(toolsWithAvailableUpdates);
  }

  availableToolUpdates(): Readable<Record<ToolCompatibilityId, ToolInfoAndLatestVersion>> {
    return derived(this._availableToolUpdates, (store) => store);
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

  /**
   * Loads the notification feed n days back for all installed applets.
   *
   * @param nDaysBack
   */
  async loadNotificationFeed(nDaysBack: number) {
    const allApplets = await toPromise(this.runningApplets);
    const allAppletIds = allApplets.map((appletHash) => encodeHashToBase64(appletHash));
    let allNotifications: AppletNotification[][] = [];
    const daysSinceEpochToday = Math.floor(Date.now() / 8.64e7);
    for (let i = 0; i < nDaysBack + 1; i++) {
      const daysSinceEpoch = daysSinceEpochToday - i;
      allAppletIds.forEach((appletId) => {
        const notifications = this.persistedStore.appletNotifications.value(
          appletId,
          daysSinceEpoch,
        );
        allNotifications.push(
          notifications.map((notification) => ({
            appletId,
            notification,
          })),
        );
      });
    }
    const allNotificationsFlattened = allNotifications.flat(1);
    this._notificationFeed.set(
      allNotificationsFlattened.sort(
        (appletNotification_a, appletNotification_b) =>
          appletNotification_b.notification.timestamp - appletNotification_a.notification.timestamp,
      ),
    );
  }

  /**
   * Updates the notification feed for the given applet Id
   *
   * @param appletId
   * @param daysSinceEpoch
   */
  updateNotificationFeed(appletId: AppletId, daysSinceEpoch: number) {
    this._notificationFeed.update((store) => {
      // console.log('store: ', store);
      const allNotificationStrings = store.map((nots) => encodeAndStringify(nots));
      const updatedAppletNotifications: string[] = this.persistedStore.appletNotifications
        .value(appletId, daysSinceEpoch)
        .map((notification) => encodeAndStringify({ appletId, notification }));
      // console.log('updatedAppletNotifications: ', updatedAppletNotifications);
      // console.log('SET: ', new Set([...store, ...updatedAppletNotifications]));
      const updatedNotifications: string[] = [
        ...new Set([...allNotificationStrings, ...updatedAppletNotifications]),
      ];
      // console.log('updatedNotifications: ', updatedNotifications);
      return updatedNotifications
        .map((notificationsString) => destringifyAndDecode<AppletNotification>(notificationsString))
        .sort(
          (appletNotification_a, appletNotification_b) =>
            appletNotification_b.notification.timestamp -
            appletNotification_a.notification.timestamp,
        );
    });
  }

  updateSearchParams(filter: string, waitingForNHosts: number) {
    this._searchParams = [filter, waitingForNHosts];
    this._searchResponses = [filter, 0];
  }

  updateSearchResults(filter: string, results: WAL[], fromCache: boolean) {
    if (!fromCache && this._searchResponses[0] === filter)
      this._searchResponses = [filter, this._searchResponses[1] + 1];
    let searchStatus;
    // Only update the search status if the filter is the same as the filter in the _searchResponses
    // otherwise results of earlier queries that arrive late may wrongly overrite the search status
    // to be still loading
    if (this._searchResponses[0] === filter) {
      searchStatus = this._searchResponses[1] === this._searchParams[1] ? 'complete' : 'loading';
    }
    console.log('Filter: ', filter);
    console.log('searchStatus: ', searchStatus);
    this._searchResults.update((store) => {
      if (this._searchParams[0] !== store[0] || this._searchParams[0] === '') {
        return [filter, results, searchStatus ? searchStatus : store[2]];
      } else if (this._searchParams[0] === filter) {
        const deduplicatedResults = Array.from(
          new Set([...store[1], ...results].map((wal) => stringifyWal(wal))),
        ).map((stringifiedHrl) => deStringifyWal(stringifiedHrl));
        return [filter, deduplicatedResults, searchStatus ? searchStatus : store[2]];
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

  async emitParentToAppletMessage(message: ParentToAppletMessage, forApplets: AppletId[]) {
    // Send to iframes of main window
    postMessageToAppletIframes({ type: 'some', ids: forApplets }, message);
    // Send to iframes of WAL windows
    console.log('@MossStore: emitParentToAppletMessage. Message: ', message);
    return window.electronAPI.parentToAppletMessage(message, forApplets);
  }

  /**
   * Clones the group DNA with a new unique network seed, and creates a group info entry in that DNA
   */
  public async createGroup(name: string, logo: string, useProgenitor: boolean): Promise<AppInfo> {
    if (!logo) throw new Error('No logo provided.');

    const appInfo = await createGroup(useProgenitor);
    await this.reloadManualStores();

    const groupDnaHash: DnaHash = appInfo.cell_info['group'][0][CellType.Provisioned].cell_id[0];

    const groupStore = await this.groupStore(groupDnaHash);

    const groupProfile: GroupProfile = {
      icon_src: logo,
      name,
    };

    try {
      if (!groupStore) throw new Error('GroupStore still undefined after joining group.');
      // Note that the person that creates the group is always the progenitor so they
      // don't need to provide a permission_hash in the GroupProfile
      await groupStore.groupClient.setGroupProfile(groupProfile);
    } catch (e) {
      if ((e as any).toString().includes('source chain head has moved')) {
        console.log('Source chan has moved error, retrying to create profile...');
        try {
          await groupStore!.groupClient.setGroupProfile(groupProfile);
        } catch (e) {
          try {
            await this.leaveGroup(groupDnaHash);
            console.error(`Failed to set up group profile - left group again: ${e}`);
          } catch (err) {
            throw new Error(`Failed to leave group after failed profile creation: ${err}`);
          }
        }
      } else {
        try {
          await this.leaveGroup(groupDnaHash);
          console.error(`Failed to set up group profile - left group again: ${e}`);
        } catch (err) {
          throw new Error(`Failed to leave group after failed profile creation: ${err}`);
        }
      }
    }

    await this.reloadManualStores();
    return appInfo;
  }

  public async joinGroup(networkSeed: string, progenitor: AgentPubKeyB64 | null): Promise<AppInfo> {
    try {
      const appInfo = await joinGroup(networkSeed, progenitor);
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
    const applets = await groupStore.groupClient.getMyJoinedAppletsHashes();

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

  /**
   * Disables all applets in the group, then disables the group dna itself.
   *
   * @param groupDnaHash
   */
  public async disableGroup(groupDnaHash: DnaHash): Promise<AppletHash[]> {
    const groupStore = await this.groupStore(groupDnaHash);
    if (!groupStore) throw new Error('No group store found for group.');

    // 1. disable all applets of that group
    try {
      await groupStore.disableAllApplets();
    } catch (e) {
      throw new Error(`Failed to disable applets of the group: ${e}`);
    }

    // 2. disable the group app itself
    const allApps = await this.adminWebsocket.listApps({});
    const groupApps = allApps.filter((app) => app.installed_app_id.startsWith('group#'));

    const appToDisable = groupApps.find(
      (app) =>
        app.cell_info['group'][0][CellType.Provisioned].cell_id[0].toString() ===
        groupDnaHash.toString(),
    );

    if (!appToDisable) throw new Error('Group with this DNA hash not found in the conductor.');

    await this.adminWebsocket.disableApp({
      installed_app_id: appToDisable.installed_app_id,
    });
    // Remove applet iframes
    const applets = await toPromise(groupStore.allMyRunningApplets);

    applets.forEach((applet) => {
      const backgroundIframe = document.getElementById(encodeHashToBase64(applet)) as
        | HTMLIFrameElement
        | undefined;
      if (backgroundIframe) {
        console.log('REMOVING IFRAME');
        backgroundIframe.remove();
      }
    });

    return applets;
  }

  /**
   * Enables the group app then enables all the applets within the group.
   *
   * @param groupDnaHash
   */
  public async enableGroup(groupDnaHash: DnaHash) {
    // 1. enable the group app
    const allApps = await this.adminWebsocket.listApps({});
    const groupApps = allApps.filter((app) => app.installed_app_id.startsWith('group#'));

    const appToDisable = groupApps.find(
      (app) =>
        app.cell_info['group'][0][CellType.Provisioned].cell_id[0].toString() ===
        groupDnaHash.toString(),
    );

    if (!appToDisable) throw new Error('Group with this DNA hash not found in the conductor.');

    await this.adminWebsocket.enableApp({
      installed_app_id: appToDisable.installed_app_id,
    });

    await this.disabledGroups.reload();
    await this.groupStores.reload();

    const groupStore = await this.groupStore(groupDnaHash);
    if (!groupStore) throw new Error('No group store found for group after enabling group.');

    // 2. enable all applets of that group
    try {
      await groupStore.reEnableAllApplets();
    } catch (e) {
      throw new Error(`Failed to re-enable applets of the group: ${e}`);
    }
  }

  disabledGroups = manualReloadStore(async () => {
    const apps = await this.adminWebsocket.listApps({});
    return apps
      .filter((app) => app.installed_app_id.startsWith('group#'))
      .filter((app) => isAppDisabled(app))
      .map((app) => app.cell_info['group'][0][CellType.Provisioned].cell_id[0] as DnaHash);
  });

  groupStores = manualReloadStore(async () => {
    const groupStores = new DnaHashMap<GroupStore>();
    const apps = await this.adminWebsocket.listApps({});
    const runningGroupsApps = apps
      .filter((app) => app.installed_app_id.startsWith('group#'))
      .filter((app) => isAppRunning(app));

    console.log('RUNNING GROUP APPS: ', runningGroupsApps);
    await Promise.all(
      runningGroupsApps.map(async (app) => {
        const groupDnaHash = app.cell_info['group'][0][CellType.Provisioned].cell_id[0];

        const token = await this.getAuthenticationToken(app.installed_app_id);
        const groupAppWebsocket = await initAppClient(token);
        const assetsClient = new AssetsClient(groupAppWebsocket);

        groupStores.set(
          groupDnaHash,
          new GroupStore(groupAppWebsocket, token, groupDnaHash, this, assetsClient),
        );
      }),
    );

    return groupStores;
  });

  allAppAssetInfos = manualReloadStore(async () => getAllAppAssetsInfos());

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

  /**
   * This only returns applets whose UI supports a cross group view according
   * to its weave.config.json
   */
  runningAppletClasses = pipe(this.runningApplets, (applets) =>
    asyncDerived(this.allAppAssetInfos, (assetInfos) => {
      const runningAppletIds = applets.map((appletHash) => encodeHashToBase64(appletHash));
      const appletClasses: Record<
        ToolCompatibilityId,
        { appletIds: AppletId[]; toolName: string }
      > = {};
      Object.entries(assetInfos).forEach(([appId, [info, weaveConfig]]) => {
        if (
          appId.startsWith('applet#') &&
          info.distributionInfo.type === 'web2-tool-list' &&
          weaveConfig?.crossGroupView
        ) {
          const appletId = appletIdFromAppId(appId);
          if (runningAppletIds.includes(appletId)) {
            const classId = info.distributionInfo.info.toolCompatibilityId;
            const otherAppletsOfSameClass = appletClasses[classId]?.appletIds;
            if (otherAppletsOfSameClass) {
              appletClasses[classId] = {
                toolName: info.distributionInfo.info.toolName,
                appletIds: [...otherAppletsOfSameClass, appletId],
              };
            } else {
              appletClasses[classId] = {
                toolName: info.distributionInfo.info.toolName,
                appletIds: [appletId],
              };
            }
          }
        }
      });
      return appletClasses;
    }),
  );

  appletClassInfo = new LazyMap((toolCompatibilityId: ToolCompatibilityId) => {
    return pipe(this.runningAppletClasses, (appletClasses) => {
      const found = Object.entries(appletClasses).find(([id, _]) => id === toolCompatibilityId);
      if (found) {
        return {
          toolCompatibilityId: found[0],
          toolName: found[1].toolName,
        };
      }
      return undefined;
    });
  });

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

      set(new AppletStore(appletHash, applet, this.conductorInfo, token, this.isAppletDev));
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
        const allMyAppletDatas = await groupClient.getMyJoinedAppletsHashes();
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
      let app = findAppForDnaHash(installedApps, dnaHash);

      if (!app) {
        const installedAppsRecent = await this.adminWebsocket.listApps({});
        app = findAppForDnaHash(installedAppsRecent, dnaHash);
        if (!app) throw new Error('The given dna is not installed');
      }
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
          if (hash.toString() === NULL_HASH.toString()) {
            return {
              dnaLocation,
              entryDefLocation: undefined,
            } as HrlLocation;
          }
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
          } as HrlLocation;
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
                      wal,
                      location.entryDefLocation
                        ? {
                            roleName: location.dnaLocation.roleName,
                            integrityZomeName: location.entryDefLocation.integrity_zome,
                            entryType: location.entryDefLocation.entry_def,
                          }
                        : undefined,
                    )
                  : Promise.resolve(undefined),
              ),
          )
        : completed(undefined),
    );
  });

  appletsForToolId = new LazyMap((toolCompatibilityId: ToolCompatibilityId) =>
    pipe(
      this.allRunningApplets,
      (runningApplets) =>
        completed(
          pickBy(
            runningApplets,
            (appletStore) =>
              toolCompatibilityIdFromDistInfoString(appletStore.applet.distribution_info) ===
              toolCompatibilityId,
          ),
        ),
      (appletsForThisToolId) =>
        mapAndJoin(appletsForThisToolId, (_, appletHash) => this.groupsForApplet.get(appletHash)),
      async (groupsByApplets) => {
        const appletsB64: Record<EntryHashB64, [AppAuthenticationToken, ProfilesLocation]> = {};

        for (const [appletHash, groups] of Array.from(groupsByApplets.entries())) {
          const appletToken = await this.getAuthenticationToken(appIdFromAppletHash(appletHash));
          if (groups.size > 0) {
            const firstGroupToken = Array.from(groups.values())[0].groupClient.authenticationToken;
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

  toolLogo = new LazyMap((toolCompatibilityId: ToolCompatibilityId) => {
    return asyncReadable<string | undefined>(async (set) => {
      const toolIcon = await this.toolIcon(toolCompatibilityId);
      set(toolIcon);
    });
  });

  appletLogo = new LazyHoloHashMap((appletHash: AppletHash) =>
    pipe(this.allAppAssetInfos, (assetInfos) => {
      const assetInfoAndAppId = Object.entries(assetInfos).find(
        ([installedAppId, _]) => appIdFromAppletHash(appletHash) === installedAppId,
      );
      if (!assetInfoAndAppId) return undefined;
      const toolCompatibilityId = toolCompatibilityIdFromDistInfo(
        assetInfoAndAppId[1][0].distributionInfo,
      );
      return this.toolLogo.get(toolCompatibilityId);
    }),
  );

  appletToolVersion = new LazyHoloHashMap((appletHash: AppletHash) =>
    pipe(this.allAppAssetInfos, (assetInfos) => {
      const assetInfoAndAppId = Object.entries(assetInfos).find(
        ([installedAppId, _]) => appIdFromAppletHash(appletHash) === installedAppId,
      );
      if (!assetInfoAndAppId) return undefined;
      const distributionInfo = assetInfoAndAppId[1][0].distributionInfo;
      return distributionInfo.type === 'web2-tool-list'
        ? distributionInfo.info.toolVersion
        : undefined;
    }),
  );

  async installApplet(appletHash: EntryHash, applet: Applet): Promise<AppInfo> {
    console.log('Installing applet with hash: ', encodeHashToBase64(appletHash));
    const appId = appIdFromAppletHash(appletHash);
    if (!applet.network_seed) {
      throw new Error(
        'Network Seed not defined. Undefined network seed is currently not supported.',
      );
    }

    const distributionInfo: DistributionInfo = JSON.parse(applet.distribution_info);
    Value.Assert(TDistributionInfo, distributionInfo);

    let appHashes: AppHashes;
    let happOrWebhappUrl: string;
    let uiPort: number | undefined;

    if (distributionInfo.type === 'web2-tool-list') {
      // In case it's applet dev mode *and* it's a tool from the dev config
      // then derive the relevant info right here
      if (this.appletDevConfig && distributionInfo.info.toolListUrl.startsWith('###DEVCONFIG###')) {
        const toolConfig = this.appletDevConfig.applets.find(
          (config) => config.name === distributionInfo.info.toolId,
        );
        if (!toolConfig) throw new Error('No matching Tool found in the dev config.');

        switch (toolConfig.source.type) {
          case 'filesystem':
            happOrWebhappUrl = `file://${toolConfig.source.path}`;
            break;
          case 'https':
            happOrWebhappUrl = toolConfig.source.url;
            break;
          case 'localhost':
            happOrWebhappUrl = `file://${toolConfig.source.happPath}`;
            break;
        }

        appHashes =
          toolConfig.source.type === 'localhost'
            ? {
                type: 'happ',
                sha256: '###DEVCONFIG###',
              }
            : {
                type: 'webhapp',
                sha256: '###DEVCONFIG###',
                happ: {
                  sha256: '###DEVCONFIG###',
                },
                ui: {
                  sha256: '###DEVCONFIG###',
                },
              };

        const uiPortString = distributionInfo.info.toolListUrl.replace('###DEVCONFIG###', '');
        if (uiPortString) {
          uiPort = parseInt(uiPortString);
        }
      } else {
        // Fetch latest version of the Tool
        const resp = await fetch(distributionInfo.info.toolListUrl, { cache: 'no-cache' });
        const toolList: DeveloperCollectiveToolList = await resp.json();

        // take all apps and add them to the list of all apps
        const toolInfo = toolList.tools.find((tool) => tool.id === distributionInfo.info.toolId);
        if (!toolInfo) throw new Error('No tool info found in developer collective.');
        // Filter by versions that have a valid semver version and the same sha256 as stored in the Applet entry
        const latestVersion = getLatestVersionFromToolInfo(toolInfo, applet.sha256_happ);
        if (!latestVersion)
          throw new Error(
            'No version found for the Tool with a valid semver version and the correct happ sha256.',
          );

        appHashes = {
          type: 'webhapp',
          sha256: latestVersion.hashes.webhappSha256, // The sha256 of the happ needs to match the one in the AppletEntry
          happ: {
            sha256: applet.sha256_happ,
          },
          ui: {
            sha256: latestVersion.hashes.uiSha256,
          },
        };

        happOrWebhappUrl = latestVersion.url;
      }
    } else {
      throw new Error(
        "Distribution info types other than 'web2-tool-list' are currently not supported.",
      );
    }

    // Only in dev mode AppHashes of type 'happ' are currently allowed
    if (appHashes.type !== 'webhapp' && !this.isAppletDev)
      throw new Error(`Got invalid AppHashes type: ${appHashes.type}. AppHashes: ${appHashes}`);

    const appInfo = await window.electronAPI.installAppletBundle(
      appId,
      applet.network_seed!,
      happOrWebhappUrl,
      distributionInfo,
      appHashes,
      uiPort,
    );

    return appInfo;
  }

  async uninstallApplet(appletHash: EntryHash): Promise<void> {
    // console.warn("@we-store: Uninstalling applet.");
    const appId = appIdFromAppletHash(appletHash);
    await window.electronAPI.uninstallAppletBundle(appId);
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
    await this.disabledGroups.reload();
    await this.groupStores.reload();
    // const groupStores = await toPromise(this.groupStores);
    // await Promise.all(
    //   Array.from(groupStores.values()).map(async (store) => {
    //     await store.allMyApplets.reload();
    //     await store.allMyRunningApplets.reload();
    //   }),
    // );
    await this.installedApps.reload();
    await this.allAppAssetInfos.reload();
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
    const walToAdd: WalInPocket = {
      addedAt: Date.now(),
      wal: walStringified,
    };
    const newPocketContent = pocketContent.filter(
      (walInPocket) => walInPocket.wal !== walToAdd.wal,
    );
    newPocketContent.push(walToAdd);
    this.persistedStore.pocket.set(newPocketContent);
    this._addedToPocket.set(true);
    setTimeout(() => {
      this._addedToPocket.set(false);
    }, 2200);
  }

  clearPocket() {
    this.persistedStore.pocket.set([]);
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
    const newPocketContent = pocketContent.filter(
      (walInPocket) => walInPocket.wal !== walStringified,
    );
    this.persistedStore.pocket.set(newPocketContent);
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
          // Update with cached results immediately if there are cached results
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
          expiry_seconds: 0,
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

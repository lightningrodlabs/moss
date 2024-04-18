import { PeerStatusClient, PeerStatusStore } from '@holochain-open-dev/peer-status';
import { ProfilesClient, ProfilesStore } from '@holochain-open-dev/profiles';
import {
  AsyncReadable,
  AsyncStatus,
  completed,
  derived,
  joinMap,
  lazyLoad,
  lazyLoadAndPoll,
  manualReloadStore,
  mapAndJoin,
  pipe,
  sliceAndJoin,
  toPromise,
} from '@holochain-open-dev/stores';
import { EntryHashMap, LazyHoloHashMap, mapValues } from '@holochain-open-dev/utils';
import {
  AgentPubKey,
  AppAgentWebsocket,
  CellType,
  DnaHash,
  EntryHash,
  encodeHashToBase64,
} from '@holochain/client';
import { v4 as uuidv4 } from 'uuid';
import { DnaModifiers } from '@holochain/client';

import { AppletHash, AppletId, GroupProfile } from '@lightningrodlabs/we-applet';

import { GroupClient } from './group-client.js';
import { CustomViewsStore } from '../custom-views/custom-views-store.js';
import { CustomViewsClient } from '../custom-views/custom-views-client.js';
import { MossStore } from '../moss-store.js';
import { AppEntry, Entity } from '../processes/appstore/types.js';
import { Applet, RegisterAppletInput } from '../types.js';
import {
  appIdFromAppletHash,
  getAllIframes,
  isAppDisabled,
  isAppRunning,
  toLowerCaseB64,
} from '../utils.js';
import { AppHashes, AppletAgent, DistributionInfo } from '../types.js';

export const NEW_APPLETS_POLLING_FREQUENCY = 10000;

// Given a group, all the functionality related to that group
export class GroupStore {
  profilesStore: ProfilesStore;

  peerStatusStore: PeerStatusStore;

  groupClient: GroupClient;

  customViewsStore: CustomViewsStore;

  members: AsyncReadable<Array<AgentPubKey>>;

  private constructed: boolean;

  constructor(
    public appAgentWebsocket: AppAgentWebsocket,
    public groupDnaHash: DnaHash,
    public mossStore: MossStore,
  ) {
    this.groupClient = new GroupClient(appAgentWebsocket, 'group');

    this.peerStatusStore = new PeerStatusStore(
      new PeerStatusClient(appAgentWebsocket, 'group'),
      {},
    );
    this.profilesStore = new ProfilesStore(new ProfilesClient(appAgentWebsocket, 'group'));
    this.customViewsStore = new CustomViewsStore(new CustomViewsClient(appAgentWebsocket, 'group'));
    this.members = this.profilesStore.agentsWithProfile;

    this.constructed = true;
  }

  public async addRelatedGroup(groupDnaHash: DnaHash, groupProfile: GroupProfile) {
    const groupStore = await this.mossStore.groupStore(groupDnaHash);

    if (!groupStore) throw new Error('Failed to add related Group: GroupStore not found.');

    const modifiers = await groupStore.groupDnaModifiers();

    await this.groupClient.addRelatedGroup({
      group_profile: groupProfile,
      network_seed: modifiers.network_seed,
      group_dna_hash: groupDnaHash,
    });
  }

  public async addFederatedApplet(input: RegisterAppletInput) {
    await this.groupClient.registerApplet(input);
    await this.allMyApplets.reload();
    await this.allMyRunningApplets.reload();
  }

  async groupDnaModifiers(): Promise<DnaModifiers> {
    const appInfo = await this.appAgentWebsocket.appInfo();
    const cellInfo = appInfo.cell_info['group'].find(
      (cellInfo) => CellType.Provisioned in cellInfo,
    );

    if (!cellInfo) throw new Error('Could not find cell for this group');

    return cellInfo[CellType.Provisioned].dna_modifiers;
  }

  networkSeed = lazyLoad(async () => {
    const dnaModifiers = await this.groupDnaModifiers();
    return dnaModifiers.network_seed;
  });

  groupProfile = lazyLoadAndPoll(async () => {
    const entryRecord = await this.groupClient.getGroupProfile();
    return entryRecord?.entry;
  }, 4000);

  // Installs an applet instance that already exists in this group into this conductor
  async installApplet(appletHash: EntryHash) {
    const applet = await this.groupClient.getApplet(appletHash);
    console.log('@groupstore: @installApplet: Got applet: ', applet);
    if (!applet) throw new Error('Given applet instance hash was not found');

    const appInfo = await this.mossStore.installApplet(appletHash, applet);
    const registerAppletInput = {
      applet,
      joining_pubkey: appInfo.agent_pub_key,
    };
    try {
      await this.groupClient.registerApplet(registerAppletInput);
    } catch (e) {
      console.error(
        `Failed to register applet in group dna after installation: ${e}\nUninstalling again.`,
      );
      try {
        await this.mossStore.uninstallApplet(appletHash);
      } catch (err) {
        console.error(
          `Failed to uninstall applet after registration of applet in group dna failed: ${err}`,
        );
      }
    }
    await this.mossStore.reloadManualStores();
  }

  /**
   * Fetches the applet from the devhub, installs it in the current conductor
   * and advertises it in the group DNA. To be called by the first agent
   * installing this specific instance of the Applet.
   */
  async installAndAdvertiseApplet(
    appEntry: Entity<AppEntry>,
    customName: string,
    networkSeed?: string,
  ): Promise<EntryHash> {
    if (!networkSeed) {
      networkSeed = uuidv4();
    }

    const appHashes: AppHashes = JSON.parse(appEntry.content.hashes);
    const appstoreDnaHash = await this.mossStore.appletBundlesStore.appstoreDnaHash();

    const distributionInfo: DistributionInfo = {
      type: 'appstore-light',
      info: {
        appstoreDnaHash,
        appEntryId: encodeHashToBase64(appEntry.id),
        appEntryActionHash: encodeHashToBase64(appEntry.action),
        appEntryEntryHash: encodeHashToBase64(appEntry.address),
      },
    };

    const applet: Applet = {
      custom_name: customName,
      description: appEntry.content.description,
      sha256_happ: appHashes.type === 'happ' ? appHashes.sha256 : appHashes.happ.sha256,
      sha256_webhapp: appHashes.type === 'webhapp' ? appHashes.sha256 : undefined,
      sha256_ui: appHashes.type === 'webhapp' ? appHashes.ui.sha256 : undefined,
      distribution_info: JSON.stringify(distributionInfo),
      network_seed: networkSeed,
      properties: {},
    };

    const appletHash = await this.groupClient.hashApplet(applet);

    const appInfo = await this.mossStore.installApplet(appletHash, applet);

    const registerAppletInput: RegisterAppletInput = {
      applet,
      joining_pubkey: appInfo.agent_pub_key,
    };

    try {
      await this.groupClient.registerApplet(registerAppletInput);
    } catch (e) {
      console.error(
        `Failed to register Applet after installation. Uninstalling again. Error:\n${e}.`,
      );
      try {
        await this.mossStore.uninstallApplet(appletHash);
        return Promise.reject(
          new Error(`Failed to register Applet: ${e}.\nApplet uninstalled again.`),
        );
      } catch (err) {
        console.error(`Failed to undo installation of Applet after failed registration: ${err}`);
        return Promise.reject(
          new Error(
            `Failed to register Applet (E1) and Applet could not be uninstalled again (E2):\nE1: ${e}\nE2: ${err}`,
          ),
        );
      }
    }

    await this.mossStore.reloadManualStores();

    return appletHash;
  }

  /**
   * Disables all applets of this group and stores which applets had already been disabled
   * in order to not re-enable those when enabling all applets again
   */
  async disableAllApplets(): Promise<Array<AppletHash>> {
    const installedApplets = await toPromise(this.allMyInstalledApplets);
    const installedApps = await this.mossStore.adminWebsocket.listApps({});
    const disabledAppIds = installedApps
      .filter((app) => isAppDisabled(app))
      .map((appInfo) => appInfo.installed_app_id);

    const disabledAppletsIds = installedApplets
      .filter((appletHash) => disabledAppIds.includes(appIdFromAppletHash(appletHash)))
      .map((appletHash) => encodeHashToBase64(appletHash));
    // persist which applets have already been disabled
    this.mossStore.persistedStore.disabledGroupApplets.set(disabledAppletsIds, this.groupDnaHash);

    const appletsToDisable: Array<AppletHash> = [];

    for (const appletHash of installedApplets) {
      // federated applets can only be disabled exlicitly
      const federatedGroups = await this.groupClient.getFederatedGroups(appletHash);
      if (federatedGroups.length === 0) {
        await this.mossStore.adminWebsocket.disableApp({
          installed_app_id: appIdFromAppletHash(appletHash),
        });
        appletsToDisable.push(appletHash);
      }
    }
    await this.mossStore.reloadManualStores();
    return appletsToDisable;
  }

  /**
   * Re-enable all applets of this group except the onse that have already been disabled
   * when calling disableAllApplets
   */
  async reEnableAllApplets() {
    const installedApplets = await toPromise(this.allMyInstalledApplets);

    const previouslyDisabled = this.mossStore.persistedStore.disabledGroupApplets.value(
      this.groupDnaHash,
    );

    const appletsToEnable = previouslyDisabled
      ? installedApplets.filter(
          (appletHash) => !previouslyDisabled.includes(encodeHashToBase64(appletHash)),
        )
      : installedApplets;

    for (const appletHash of appletsToEnable) {
      await this.mossStore.adminWebsocket.enableApp({
        installed_app_id: appIdFromAppletHash(appletHash),
      });
    }
    // remove disabled group applets from persisted store since this also acts as an
    // indicator for whether the group is disabled or not
    this.mossStore.persistedStore.disabledGroupApplets.set(undefined, this.groupDnaHash);

    await this.mossStore.reloadManualStores();
  }

  appletFederatedGroups = new LazyHoloHashMap((appletHash: EntryHash) =>
    lazyLoadAndPoll(async () => this.groupClient.getFederatedGroups(appletHash), 5000),
  );

  applets = new LazyHoloHashMap((appletHash: EntryHash) =>
    lazyLoad(async () => this.groupClient.getApplet(appletHash)),
  );

  // need to change this. allApplets needs to come from the conductor
  // Currently unused
  // allGroupApplets = lazyLoadAndPoll(async () => this.groupClient.getGroupApplets(), APPLETS_POLLING_FREQUENCY);

  allMyInstalledApplets = manualReloadStore(async () => {
    const allMyApplets = await (async () => {
      if (!this.constructed) {
        return retryUntilResolved<Array<AppletHash>>(
          () => this.groupClient.getMyAppletsHashes(),
          200,
          undefined,
          false,
        );
      }
      return this.groupClient.getMyAppletsHashes();
    })();

    const installedApps = await this.mossStore.adminWebsocket.listApps({});

    const output = allMyApplets.filter((appletHash) =>
      installedApps
        .map((appInfo) => appInfo.installed_app_id)
        .includes(`applet#${toLowerCaseB64(encodeHashToBase64(appletHash))}`),
    );
    return output;
  });

  allMyRunningApplets = manualReloadStore(async () => {
    const allMyApplets = await (async () => {
      if (!this.constructed) {
        return retryUntilResolved<Array<AppletHash>>(
          () => this.groupClient.getMyAppletsHashes(),
          200,
          undefined,
          false,
        );
      }
      return this.groupClient.getMyAppletsHashes();
    })();
    // const allMyApplets = await this.groupClient.getMyApplets();
    const installedApps = await this.mossStore.adminWebsocket.listApps({});
    const runningAppIds = installedApps
      .filter((app) => isAppRunning(app))
      .map((appInfo) => appInfo.installed_app_id);

    // console.log('Got runningAppIds: ', runningAppIds);
    // console.log(
    //   'Got allMyApplets: ',
    //   allMyApplets.map((hash) => encodeHashToBase64(hash)),
    // );

    const output = allMyApplets.filter((appletHash) =>
      runningAppIds.includes(`applet#${toLowerCaseB64(encodeHashToBase64(appletHash))}`),
    );
    // console.log('Got allMyRunningApplets: ', output);
    return output;
  });

  allMyApplets = manualReloadStore(async () => {
    if (!this.constructed) {
      return retryUntilResolved<Array<AppletHash>>(
        () => this.groupClient.getMyAppletsHashes(),
        200,
        undefined,
        false,
      );
    }
    return this.groupClient.getMyAppletsHashes();
  });

  allAdvertisedApplets = manualReloadStore(async () => {
    if (!this.constructed) {
      return retryUntilResolved<Array<AppletHash>>(
        () => this.groupClient.getGroupApplets(),
        200,
        undefined,
        false,
      );
    }
    return this.groupClient.getMyAppletsHashes();
  });

  // Applets that have been registered in the group by someone else but have never been installed
  // in the local conductor yet (provided that storing the Applet entry to the local source chain has
  // succeeded for every Applet that has been installed into the conductor)
  unjoinedApplets = lazyLoadAndPoll(async () => {
    const unjoinedApplets = await this.groupClient.getUnjoinedApplets();
    const unjoinedAppletsWithGroupMembers: EntryHashMap<[AgentPubKey, number, AppletAgent[]]> =
      new EntryHashMap();
    try {
      await Promise.all(
        unjoinedApplets.map(async ([appletHash, addingAgent, timestamp]) => {
          const joinedMembers = await this.groupClient.getJoinedAppletAgents(appletHash);
          unjoinedAppletsWithGroupMembers.set(appletHash, [addingAgent, timestamp, joinedMembers]);
        }),
      );
    } catch (e) {
      console.warn('Failed to get joined members for unjoined applets: ', e);
      const unjoinedAppletsWithGroupMembersFallback: EntryHashMap<
        [AgentPubKey, number, AppletAgent[]]
      > = new EntryHashMap();
      unjoinedApplets.forEach(([appletHash, addingAgent, timestamp]) => {
        unjoinedAppletsWithGroupMembersFallback.set(appletHash, [addingAgent, timestamp, []]);
      });
      return unjoinedAppletsWithGroupMembersFallback;
    }
    return unjoinedAppletsWithGroupMembers;
  }, NEW_APPLETS_POLLING_FREQUENCY);

  // Currently unused
  // Would be nice to show archived applets also if explicitly desired by the user but should not be polling constantly
  // archivedApplets = lazyLoadAndPoll(
  //   async () => this.groupClient.getArchivedApplets(),
  //   4000
  // );

  // installedApplets = asyncDerived(
  //   joinAsync([this.allMyApplets, this.mossStore.appletBundlesStore.installedApplets]),
  //   ([myApplets, installedApplets]) =>
  //     myApplets.filter((appletHash) =>
  //       installedApplets.find(
  //         (installedAppletHash) =>
  //           installedAppletHash.toString() === appletHash.toString()
  //       )
  //     )
  // );

  activeAppletStores = pipe(this.allMyApplets, (allApplets) =>
    sliceAndJoin(this.mossStore.appletStores, allApplets),
  );

  allBlocks = pipe(this.activeAppletStores, (appletsStores) =>
    mapAndJoin(appletsStores, (s) => s.blocks),
  );

  relatedGroups = lazyLoadAndPoll(() => this.groupClient.getRelatedGroups(), 10000);

  allUnreadNotifications = pipe(
    this.activeAppletStores,
    (allAppletStores) =>
      derived(
        joinMap(mapValues(allAppletStores, (store) => store.unreadNotifications())),
        (map) =>
          ({ status: 'complete', value: map }) as AsyncStatus<
            ReadonlyMap<Uint8Array, [string | undefined, number | undefined]>
          >,
      ),
    (notificationsMap) => {
      const notificationCounts = { low: 0, medium: 0, high: 0 };
      Array.from(notificationsMap.values()).forEach(([urgency, count]) => {
        if (urgency) notificationCounts[urgency] += count;
      });

      if (notificationCounts.high) {
        return completed(['high', notificationCounts.high] as [
          string | undefined,
          number | undefined,
        ]);
      } else if (notificationCounts.medium) {
        return completed(['medium', notificationCounts.medium] as [
          string | undefined,
          number | undefined,
        ]);
      } else if (notificationCounts.low) {
        return completed(['low', notificationCounts.low] as [
          string | undefined,
          number | undefined,
        ]);
      }
      return completed([undefined, undefined] as [string | undefined, number | undefined]);
    },
  );
}

async function retryUntilResolved<T>(
  fn: () => Promise<T>,
  retryInterval: number = 200,
  maxRetries: number | undefined = undefined,
  logErrors: boolean = false,
) {
  try {
    return await fn();
  } catch (e) {
    if (logErrors) {
      console.warn(`Failed to resolve fn in retryUntilResolved. Error: ${e}.\nfn: ${fn}`);
    }
    if (maxRetries && maxRetries <= 1) {
      throw new Error(`Failed to to call function after ${maxRetries} attempts: ${e}.\nfn ${fn}`);
    }
    await delay(retryInterval);
    return retryUntilResolved<T>(
      fn,
      retryInterval,
      maxRetries ? maxRetries - 1 : undefined,
      logErrors,
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

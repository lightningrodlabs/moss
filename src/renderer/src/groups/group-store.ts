import { PeerStatusClient, PeerStatusStore } from '@holochain-open-dev/peer-status';
import { ProfilesClient, ProfilesStore } from '@holochain-open-dev/profiles';
import {
  asyncDerived,
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
} from '@holochain-open-dev/stores';
import { LazyHoloHashMap, mapValues } from '@holochain-open-dev/utils';
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

import { AppletHash, GroupProfile } from '@lightningrodlabs/we-applet';

import { GroupClient } from './group-client.js';
import { CustomViewsStore } from '../custom-views/custom-views-store.js';
import { CustomViewsClient } from '../custom-views/custom-views-client.js';
import { WeStore } from '../we-store.js';
import { AppEntry, Entity, HappReleaseEntry } from '../processes/appstore/types.js';
import { Applet } from '../applets/types.js';
import { isAppRunning, toLowerCaseB64 } from '../utils.js';

export const NEW_APPLETS_POLLING_FREQUENCY = 15000;

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
    public weStore: WeStore,
  ) {
    this.groupClient = new GroupClient(appAgentWebsocket, 'group');

    this.peerStatusStore = new PeerStatusStore(new PeerStatusClient(appAgentWebsocket, 'group'));
    this.profilesStore = new ProfilesStore(new ProfilesClient(appAgentWebsocket, 'group'));
    this.customViewsStore = new CustomViewsStore(new CustomViewsClient(appAgentWebsocket, 'group'));
    this.members = this.profilesStore.agentsWithProfile;

    this.constructed = true;
  }

  public async addRelatedGroup(groupDnaHash: DnaHash, groupProfile: GroupProfile) {
    const groupStore = await this.weStore.groupStore(groupDnaHash);

    if (!groupStore) throw new Error('Failed to add related Group: GroupStore not found.');

    const modifiers = await groupStore.groupDnaModifiers();

    await this.groupClient.addRelatedGroup({
      group_profile: groupProfile,
      network_seed: modifiers.network_seed,
      group_dna_hash: groupDnaHash,
    });
  }

  public async addFederatedApplet(applet: Applet) {
    await this.groupClient.registerApplet(applet);
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

    if (!applet) throw new Error('Given applet instance hash was not found');

    await this.weStore.installApplet(appletHash, applet, applet.initial_devhub_gui_release_hash);
    try {
      await this.groupClient.registerApplet(applet);
    } catch (e) {
      console.error(
        `Failed to register applet in group dna after installation: ${e}\nUninstalling again.`,
      );
      try {
        await this.weStore.uninstallApplet(appletHash);
      } catch (err) {
        console.error(
          `Failed to uninstall applet after registration of applet in group dna failed: ${err}`,
        );
      }
    }
  }

  /**
   * Fetches the applet from the devhub, installs it in the current conductor
   * and advertises it in the group DNA. To be called by the first agent
   * installing this specific instance of the Applet.
   */
  async installAndAdvertiseApplet(
    appEntry: Entity<AppEntry>,
    customName: string,
    happRelease: Entity<HappReleaseEntry>,
    networkSeed?: string,
  ): Promise<EntryHash> {
    if (!networkSeed) {
      networkSeed = uuidv4();
    }

    const applet: Applet = {
      custom_name: customName,
      description: appEntry.content.description,

      appstore_app_hash: appEntry.id,

      devhub_dna_hash: appEntry.content.devhub_address.dna,
      devhub_happ_entry_action_hash: appEntry.content.devhub_address.happ,
      devhub_happ_release_hash: happRelease.id,
      initial_devhub_gui_release_hash: happRelease.content.official_gui,
      network_seed: networkSeed,
      properties: {},
    };

    const appletHash = await this.groupClient.hashApplet(applet);

    await this.weStore.installApplet(appletHash, applet, happRelease.content.official_gui);

    try {
      await this.groupClient.registerApplet(applet);
    } catch (e) {
      console.error(
        `Failed to register Applet after installation. Uninstalling again. Error:\n${e}.`,
      );
      try {
        await this.weStore.uninstallApplet(appletHash);
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

    return appletHash;
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

  allMyRunningApplets = manualReloadStore(async () => {
    const allMyApplets = await (async () => {
      if (!this.constructed) {
        return retryUntilResolved<Array<AppletHash>>(
          () => this.groupClient.getMyApplets(),
          200,
          undefined,
          false,
        );
      }
      return this.groupClient.getMyApplets();
    })();
    // const allMyApplets = await this.groupClient.getMyApplets();
    const installedApps = await this.weStore.adminWebsocket.listApps({});
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
        () => this.groupClient.getMyApplets(),
        200,
        undefined,
        false,
      );
    }
    return this.groupClient.getMyApplets();
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
    return this.groupClient.getMyApplets();
  });

  // Applets that have been registered in the group by someone else but have never been installed
  // in the local conductor yet (provided that storing the Applet entry to the local source chain has
  // succeeded for every Applet that has been installed into the conductor)
  unjoinedApplets = lazyLoadAndPoll(
    async () => this.groupClient.getUnjoinedApplets(),
    NEW_APPLETS_POLLING_FREQUENCY,
  );

  // Currently unused
  // Would be nice to show archived applets also if explicitly desired by the user but should not be polling constantly
  // archivedApplets = lazyLoadAndPoll(
  //   async () => this.groupClient.getArchivedApplets(),
  //   4000
  // );

  // installedApplets = asyncDerived(
  //   joinAsync([this.allMyApplets, this.weStore.appletBundlesStore.installedApplets]),
  //   ([myApplets, installedApplets]) =>
  //     myApplets.filter((appletHash) =>
  //       installedApplets.find(
  //         (installedAppletHash) =>
  //           installedAppletHash.toString() === appletHash.toString()
  //       )
  //     )
  // );

  activeAppletStores = pipe(this.allMyApplets, (allApplets) =>
    sliceAndJoin(this.weStore.appletStores, allApplets),
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

  appletUiUpdatesAvailable = asyncDerived(this.allMyRunningApplets, (myApplets) => {
    let updatesAvailable = false;
    myApplets.forEach((appletHash) => {
      if (this.weStore.availableUiUpdates[`applet#${encodeHashToBase64(appletHash)}`]) {
        updatesAvailable = true;
      }
    });
    return updatesAvailable;
  });
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

import { ProfilesClient, ProfilesStore } from '@holochain-open-dev/profiles';
import {
  AsyncReadable,
  AsyncStatus,
  Readable,
  Writable,
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
  writable,
} from '@holochain-open-dev/stores';
import { EntryHashMap, LazyHoloHashMap, ZomeClient, mapValues } from '@holochain-open-dev/utils';
import {
  ActionHash,
  AgentPubKey,
  AgentPubKeyB64,
  AppAuthenticationToken,
  AppClient,
  AppWebsocket,
  CellType,
  DnaHash,
  EntryHash,
  RoleName,
  encodeHashToBase64,
} from '@holochain/client';
import { v4 as uuidv4 } from 'uuid';
import { DnaModifiers } from '@holochain/client';

import { AppletHash, ParentToAppletMessage, PeerStatus } from '@lightningrodlabs/we-applet';

import { GroupClient } from './group-client.js';
import { CustomViewsStore } from '../custom-views/custom-views-store.js';
import { CustomViewsClient } from '../custom-views/custom-views-client.js';
import { MossStore } from '../moss-store.js';
import { Applet, JoinAppletInput } from '../types.js';
import {
  appIdFromAppletHash,
  isAppDisabled,
  isAppRunning,
  lazyReloadableStore,
  reloadableLazyLoadAndPollUntil,
  toLowerCaseB64,
} from '../utils.js';
import { AppHashes, AppletAgent, DistributionInfo } from '../types.js';
import { Tool, UpdateableEntity } from '../tools-library/types.js';

export const NEW_APPLETS_POLLING_FREQUENCY = 10000;
const AGENTS_REFETCH_FREQUENCY = 10;
const PING_AGENTS_FREQUENCY_MS = 8000;
export const OFFLINE_THRESHOLD = 20000;
export const IDLE_THRESHOLD = 40000;

// Given a group, all the functionality related to that group
export class GroupStore {
  profilesStore: ProfilesStore;

  groupClient: GroupClient;

  peerStatusClient: PeerStatusClient;

  customViewsStore: CustomViewsStore;

  members: AsyncReadable<Array<AgentPubKey>>;

  _peerStatuses: Writable<Record<AgentPubKeyB64, PeerStatus> | undefined>;

  /**
   * If this exceeds a certain number, agents get refetched from the DHT
   */
  _agentsRefetchCounter: number = 0;

  allAgents: AgentPubKey[] | undefined;

  private constructed: boolean;

  _myPubkeySum: number;

  constructor(
    public appWebsocket: AppWebsocket,
    public authenticationToken: AppAuthenticationToken,
    public groupDnaHash: DnaHash,
    public mossStore: MossStore,
  ) {
    this.groupClient = new GroupClient(appWebsocket, authenticationToken, 'group');

    this.peerStatusClient = new PeerStatusClient(appWebsocket, 'group');
    this.profilesStore = new ProfilesStore(new ProfilesClient(appWebsocket, 'group'));
    this.customViewsStore = new CustomViewsStore(new CustomViewsClient(appWebsocket, 'group'));
    this.members = this.profilesStore.agentsWithProfile;

    this._peerStatuses = writable({});

    this._myPubkeySum = Array.from(this.groupClient.myPubKey).reduce((acc, curr) => acc + curr, 0);

    this.peerStatusClient.onSignal(async (signal: SignalPayload) => {
      if (signal.type == 'Pong') {
        this.updatePeerStatus(signal.from_agent, signal.status);
      }
      if (signal.type == 'Ping') {
        const now = Date.now();
        const status =
          now - this.mossStore.myLatestActivity > IDLE_THRESHOLD ? 'inactive' : 'online';
        this.updatePeerStatus(signal.from_agent, signal.status);
        await this.peerStatusClient.pong([signal.from_agent], status);
      }
    });

    setInterval(async () => {
      const now = Date.now();
      const myStatus =
        now - this.mossStore.myLatestActivity > IDLE_THRESHOLD ? 'inactive' : 'online';
      // Set unresponsive agents to offline
      this._peerStatuses.update((statuses) => {
        if (!statuses) {
          statuses = {};
        }
        Object.keys(statuses).forEach((agent) => {
          if (now - statuses[agent].lastSeen > OFFLINE_THRESHOLD) {
            statuses[agent] = {
              lastSeen: statuses[agent].lastSeen,
              status: 'offline',
            };
          }
        });
        statuses[encodeHashToBase64(this.groupClient.myPubKey)] = {
          lastSeen: now,
          status: myStatus,
        };
        return statuses;
      });
      await this.pingAgents();
    }, PING_AGENTS_FREQUENCY_MS);

    this.constructed = true;
  }

  async groupDnaModifiers(): Promise<DnaModifiers> {
    const appInfo = await this.appWebsocket.appInfo();
    const cellInfo = appInfo.cell_info['group'].find(
      (cellInfo) => CellType.Provisioned in cellInfo,
    );

    if (!cellInfo) throw new Error('Could not find cell for this group');

    return cellInfo[CellType.Provisioned].dna_modifiers;
  }

  modifiers = lazyLoad(async () => {
    const dnaModifiers = await this.groupDnaModifiers();
    return dnaModifiers;
  });

  permissionType = lazyReloadableStore(async () => this.groupClient.getMyPermissionType());

  allAgentPermissionTypes = lazyReloadableStore(async () =>
    this.groupClient.getAllAgentPermissionTypes(),
  );

  groupProfile = reloadableLazyLoadAndPollUntil(
    async () => {
      // only poll in case groupProfile is not yet defined
      const entryRecord = await this.groupClient.getGroupProfile();
      return entryRecord?.entry;
    },
    undefined,
    3000,
  );

  groupDescription = reloadableLazyLoadAndPollUntil(
    async () => {
      const entryRecord = await this.groupClient.getGroupMetaData('description');
      return entryRecord?.entry;
    },
    undefined,
    10000,
  );

  peerStatuses(): Readable<Record<AgentPubKeyB64, PeerStatus> | undefined> {
    return derived(this._peerStatuses, (state) => state);
  }

  updatePeerStatus(agent: AgentPubKey, status: string) {
    this._peerStatuses.update((value) => {
      if (!value) {
        value = {};
      }
      value[encodeHashToBase64(agent)] = {
        lastSeen: Date.now(),
        status,
      };
      return value;
    });
  }

  /**
   * Pings all agents, provided that they need to be pinged based on the needsPinging function
   */
  async pingAgents(): Promise<void> {
    const now = Date.now();
    const status = now - this.mossStore.myLatestActivity > IDLE_THRESHOLD ? 'inactive' : 'online';
    if (this.allAgents && this._agentsRefetchCounter < AGENTS_REFETCH_FREQUENCY) {
      const agentsThatNeedPinging = this.allAgents.filter(
        (agent) =>
          agent.toString() !== this.groupClient.myPubKey.toString() && this.needsPinging(agent),
      );
      return agentsThatNeedPinging.length > 0
        ? this.peerStatusClient.ping(agentsThatNeedPinging, status)
        : Promise.resolve();
    } else {
      const allAgents = await this.profilesStore.client.getAgentsWithProfile();
      this.allAgents = allAgents;
      const agentsThatNeedPinging = allAgents.filter(
        (agent) =>
          agent.toString() !== this.groupClient.myPubKey.toString() && this.needsPinging(agent),
      );
      this._agentsRefetchCounter = 0;
      return agentsThatNeedPinging.length > 0
        ? this.peerStatusClient.ping(agentsThatNeedPinging, status)
        : Promise.resolve();
    }
  }

  /**
   * Function that returns deterministically but with 50% probability for a given pair
   * of public keys whether an agent needs to be pinged
   * @param agent
   */
  needsPinging(agent: AgentPubKey): boolean {
    const pubkeySum = Array.from(agent).reduce((acc, curr) => acc + curr, 0);
    const diff = pubkeySum - this._myPubkeySum;
    if (diff % 2 === 0) {
      if (diff === 0) return true;
      return this._myPubkeySum > pubkeySum;
    } else {
      return this._myPubkeySum < pubkeySum;
    }
  }

  // Installs an applet instance that already exists in this group into this conductor
  async installApplet(appletHash: EntryHash) {
    const applet = await this.groupClient.getApplet(appletHash);
    console.log('@groupstore: @installApplet: Got applet: ', applet);
    if (!applet) throw new Error('Given applet instance hash was not found');

    const appInfo = await this.mossStore.installApplet(appletHash, applet);
    const joinAppletInput = {
      applet,
      joining_pubkey: appInfo.agent_pub_key,
    };
    try {
      await this.groupClient.joinApplet(joinAppletInput);
    } catch (e) {
      console.error(
        `Failed to join applet in group dna after installation: ${e}\nUninstalling again.`,
      );
      try {
        await this.mossStore.uninstallApplet(appletHash);
      } catch (err) {
        console.error(
          `Failed to uninstall applet after joining of applet in group dna failed: ${err}`,
        );
      }
    }
    await this.mossStore.reloadManualStores();
  }

  /**
   * Fetches the applet from the devhub, installs it in the current conductor
   * and advertises it in the group DNA. To be called by the first agent
   * installing this specific instance of the Applet.
   * This function can only successfully be called by the Progenitor or
   * Stewards.
   */
  async installAndAdvertiseApplet(
    toolBundleEntity: UpdateableEntity<Tool>,
    customName: string,
    networkSeed?: string,
    permissionHash?: ActionHash,
  ): Promise<EntryHash> {
    if (!networkSeed) {
      networkSeed = uuidv4();
    }

    const appHashes: AppHashes = JSON.parse(toolBundleEntity.record.entry.hashes);
    const toolsLibraryDnaHash = await this.mossStore.toolsLibraryStore.toolsLibraryDnaHash();

    const distributionInfo: DistributionInfo = {
      type: 'tools-library',
      info: {
        toolsLibraryDnaHash: encodeHashToBase64(toolsLibraryDnaHash),
        originalToolActionHash: encodeHashToBase64(toolBundleEntity.originalActionHash),
        toolVersionActionHash: encodeHashToBase64(toolBundleEntity.record.actionHash),
        toolVersionEntryHash: encodeHashToBase64(toolBundleEntity.record.entryHash),
      },
    };

    const applet: Applet = {
      permission_hash: permissionHash,
      custom_name: customName,
      description: toolBundleEntity.record.entry.description,
      sha256_happ: appHashes.type === 'happ' ? appHashes.sha256 : appHashes.happ.sha256,
      sha256_webhapp: appHashes.type === 'webhapp' ? appHashes.sha256 : undefined,
      sha256_ui: appHashes.type === 'webhapp' ? appHashes.ui.sha256 : undefined,
      distribution_info: JSON.stringify(distributionInfo),
      network_seed: networkSeed,
      properties: {},
    };

    const appletHash = await this.groupClient.hashApplet(applet);

    const appInfo = await this.mossStore.installApplet(appletHash, applet);

    const joinAppletInput: JoinAppletInput = {
      applet,
      joining_pubkey: appInfo.agent_pub_key,
    };

    try {
      await this.groupClient.registerAndJoinApplet(joinAppletInput);
    } catch (e) {
      console.error(
        `Failed to register and join Applet after installation. Uninstalling again. Error:\n${e}.`,
      );
      try {
        await this.mossStore.uninstallApplet(appletHash);
        return Promise.reject(
          new Error(`Failed to register and join Applet: ${e}.\nApplet uninstalled again.`),
        );
      } catch (err) {
        console.error(`Failed to undo installation of Applet after failed registration: ${err}`);
        return Promise.reject(
          new Error(
            `Failed to register and join Applet (E1) and Applet could not be uninstalled again (E2):\nE1: ${e}\nE2: ${err}`,
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
      await this.mossStore.adminWebsocket.disableApp({
        installed_app_id: appIdFromAppletHash(appletHash),
      });
      appletsToDisable.push(appletHash);
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
          () => this.groupClient.getMyJoinedAppletsHashes(),
          200,
          undefined,
          false,
        );
      }
      return this.groupClient.getMyJoinedAppletsHashes();
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
          () => this.groupClient.getMyJoinedAppletsHashes(),
          200,
          undefined,
          false,
        );
      }
      return this.groupClient.getMyJoinedAppletsHashes();
    })();
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
        () => this.groupClient.getMyJoinedAppletsHashes(),
        200,
        undefined,
        false,
      );
    }
    return this.groupClient.getMyJoinedAppletsHashes();
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
    return this.groupClient.getMyJoinedAppletsHashes();
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

  /**
   * Emits an iframe message to all applet hosts. Will not return the response if
   * one is expected.
   * @param message
   */
  async emitToAppletHosts(message: ParentToAppletMessage): Promise<void> {
    const appletStores = await toPromise(this.activeAppletStores);
    await Promise.allSettled(
      Array.from(appletStores.values()).map(async (appletStore) => {
        const appletHost = await toPromise(appletStore.host);
        if (appletHost) {
          await appletHost.postMessage(message);
        }
      }),
    );
  }
}

export class PeerStatusClient extends ZomeClient<SignalPayload> {
  constructor(
    public client: AppClient,
    public roleName: RoleName,
    public zomeName = 'peer_status',
  ) {
    super(client, roleName, zomeName);
  }

  /**
   * Ping all specified agents, expecting for their pong later
   */
  async ping(agentPubKeys: AgentPubKey[], status): Promise<void> {
    return this.callZome('ping', {
      to_agents: agentPubKeys,
      status,
    });
  }

  /**
   * Pong all specified agents
   */
  async pong(agentPubKeys: AgentPubKey[], status): Promise<void> {
    return this.callZome('pong', {
      to_agents: agentPubKeys,
      status,
    });
  }
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

export type SignalPayload =
  | {
      type: 'Ping';
      from_agent: AgentPubKey;
      status: string;
    }
  | {
      type: 'Pong';
      from_agent: AgentPubKey;
      status: string;
    };

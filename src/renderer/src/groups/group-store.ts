import { Profile, ProfilesClient, ProfilesStore } from '@holochain-open-dev/profiles';
import {
  AsyncReadable,
  AsyncStatus,
  Readable,
  Unsubscriber,
  Writable,
  asyncReadable,
  completed,
  derived,
  get,
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
import {EntryRecord, GetonlyMap, mapValues} from '@holochain-open-dev/utils';
import {
    ActionHash,
    AgentPubKey,
    AgentPubKeyB64,
    AppAuthenticationToken,
    AppWebsocket,
    CellType,
    DnaHash,
    EntryHash,
    EntryHashMap,
    decodeHashFromBase64,
    encodeHashToBase64,
    hashFrom32AndType,
    HoloHashType,
    LazyHoloHashMap, HoloHashMap,
} from '@holochain/client';
import { v4 as uuidv4 } from 'uuid';
import { DnaModifiers } from '@holochain/client';
import {
  AppletHash,
  AppletId,
  AssetStoreContent,
  ParentToAppletMessage,
  PeerStatus,
  WAL,
  deStringifyWal,
  stringifyWal,
} from '@theweave/api';
import { Value } from '@sinclair/typebox/value';

import { CustomViewsStore } from '../custom-views/custom-views-store.js';
import { CustomViewsClient } from '../custom-views/custom-views-client.js';
import { MossStore } from '../moss-store.js';
import {
  dedupStringArray,
  lazyReloadableStore,
  reloadableLazyLoadAndPollUntil,
  safeSetInterval,
  SafeIntervalHandle,
  onlineDebugLog,
} from '../utils.js';
import { DistributionInfo, TDistributionInfo } from '@theweave/moss-types';
import {
  AssetRelationWithTags,
  decodeAssetRelationWALs,
  GroupRemoteSignal,
  PeerStatusClient,
  SignalPayloadAssets,
  SignalPayloadPeerStatus,
  walDecodeContext,
} from '@theweave/group-client';
import { FoyerStore } from './foyer.js';
import {
  appIdFromAppletHash,
  deriveToolCompatibilityId,
  isAppDisabled,
  isAppRunning,
  toLowerCaseB64
} from '@theweave/utils';
import { decode, encode } from '@msgpack/msgpack';
import {
  AssetsClient,
  Applet,
  JoinAppletInput,
  GroupClient,
  AppletAgent,
} from '@theweave/group-client';
import isEqual from 'lodash-es/isEqual.js';
import { ToolAndCurationInfo } from '../types.js';
import {AppletStore} from "../applets/applet-store";
import { FoyerNotificationSettings, DEFAULT_FOYER_NOTIFICATION_SETTINGS } from '../applets/types.js';

export const NEW_APPLETS_POLLING_FREQUENCY = 10000;
const PING_AGENTS_FREQUENCY_MS = 8000;
const GET_AGENT_INFO_FREQUENCY_MS = 10000; // Poll agentInfo to discover agents in network
export const OFFLINE_THRESHOLD = 26000; // Peer is considered offline if they did not respond to 3 consecutive pings
export const IDLE_THRESHOLD = 300000; // Peer is considered inactive after 5 minutes without interaction inside Moss
const ASSET_RELATION_POLLING_PERIOD = 10000;

export type MaybeProfile =
  | {
    type: 'unknown';
  }
  | {
    type: 'profile';
    profile: EntryRecord<Profile>;
  };

// Given a group, all the functionality related to that group
export class GroupStore {
  profilesStore: ProfilesStore;

  groupClient: GroupClient;

  peerStatusClient: PeerStatusClient;

  customViewsStore: CustomViewsStore;

  allProfiles: AsyncReadable<ReadonlyMap<AgentPubKey, MaybeProfile>>;

  _peerStatuses: Writable<Record<AgentPubKeyB64, PeerStatus> | undefined>;

  /**
   * Reactive store that calculates the number of online peers (excluding self).
   * Counts agents with status 'online' or 'inactive'.
   */
  onlinePeersCount: Readable<number | undefined>;

  private _knownAgents: Writable<Set<AgentPubKeyB64>> = writable(new Set());

  private _ignoredApplets: Writable<AppletId[]> = writable([]);

  /**
   * Ephemeral (in-memory) tracking of unread group notifications.
   * Used for foyer messages and other group-level notifications.
   * Not persisted across app restarts.
   */
  private _unreadGroupNotifications: Writable<{ low: number; medium: number; high: number }> = writable({
    low: 0,
    medium: 0,
    high: 0,
  });

  /**
   * Foyer notification settings for this group.
   * Allows separate urgency levels for mentions vs all other messages.
   */
  private _foyerNotificationSettings: Writable<FoyerNotificationSettings> = writable(DEFAULT_FOYER_NOTIFICATION_SETTINGS);

  foyerStore!: FoyerStore;

  /**
   * If this exceeds a certain number, agents get refetched from the DHT
   */
  _agentsRefetchCounter: number = 0;

  allAgents: AgentPubKey[] | undefined;

  private constructed: boolean;

  _groupIdShort: string = '';
  _instanceId: string = '';

  _myPubkeySum: number;

  _assetStores: Record<
    string,
    {
      subscriberCounts: Record<AppletId, number>;
      store: Writable<AsyncStatus<AssetStoreContent>>;
      unsubscribe: Unsubscriber | undefined;
    }
  > = {};

  // Interval handles for cleanup
  private _pingIntervalHandle: SafeIntervalHandle | undefined;
  private _agentInfoIntervalHandle: SafeIntervalHandle | undefined;
  private _assetRelationsIntervalHandle: SafeIntervalHandle | undefined;

  // Signal handler unsubscribers for cleanup
  private _peerStatusSignalUnsub: (() => void) | undefined;
  private _groupSignalUnsub: (() => void) | undefined;
  private _assetsSignalUnsub: (() => void) | undefined;

  constructor(
    public appWebsocket: AppWebsocket,
    public authenticationToken: AppAuthenticationToken,
    public groupDnaHash: DnaHash,
    public mossStore: MossStore,
    public assetsClient: AssetsClient,
  ) {
    this.groupClient = new GroupClient(appWebsocket, authenticationToken, 'group');

    this.peerStatusClient = new PeerStatusClient(appWebsocket, 'group');
    this.profilesStore = new ProfilesStore(new ProfilesClient(appWebsocket, 'group'));
    this.customViewsStore = new CustomViewsStore(new CustomViewsClient(appWebsocket, 'group'));

    FoyerStore.create(this, this.profilesStore, appWebsocket, authenticationToken, 'foyer').then(
      (instance) => {
        this.foyerStore = instance;
        // Use the instance
      },
    );

    // Load persisted foyer notification settings
    this.loadFoyerNotificationSettings();

    this._peerStatuses = writable(undefined);

    this._myPubkeySum = Array.from(this.groupClient.myPubKey).reduce((acc, curr) => acc + curr, 0);

    const groupIdShort = encodeHashToBase64(this.groupDnaHash).slice(0, 8);
    this._groupIdShort = groupIdShort;
    this._instanceId = Math.random().toString(36).slice(2, 6);

    onlineDebugLog(`[OnlineDebug][${groupIdShort}] GroupStore created (instance=${this._instanceId})`);

    // Track per-agent previous status to only log transitions
    const _prevAgentStatus: Record<string, string> = {};

    this._peerStatusSignalUnsub = this.peerStatusClient.onSignal(async (signal: SignalPayloadPeerStatus) => {
      if (signal.type == 'Pong') {
        const agentB64 = encodeHashToBase64(signal.from_agent);
        const prev = _prevAgentStatus[agentB64];
        onlineDebugLog(`[OnlineDebug][${groupIdShort}] Pong from ${agentB64.slice(0, 8)}: ${prev ?? 'unknown'} -> ${signal.status} (instance=${this._instanceId})`);
        _prevAgentStatus[agentB64] = signal.status;
        this.updatePeerStatus(signal.from_agent, signal.status, signal.tz_utc_offset);
      }
      if (signal.type == 'Ping') {
        const agentB64 = encodeHashToBase64(signal.from_agent);
        const prev = _prevAgentStatus[agentB64];
        onlineDebugLog(`[OnlineDebug][${groupIdShort}] Ping from ${agentB64.slice(0, 8)}: ${prev ?? 'unknown'} -> ${signal.status} (instance=${this._instanceId})`);
        _prevAgentStatus[agentB64] = signal.status;
        const now = Date.now();
        const status =
          now - this.mossStore.myLatestActivity > IDLE_THRESHOLD ? 'inactive' : 'online';
        this.updatePeerStatus(signal.from_agent, signal.status, signal.tz_utc_offset);
        await this.peerStatusClient.pong([signal.from_agent], status, this.mossStore.tzUtcOffset());
      }
    });

    this.allProfiles = pipe(this.profilesStore.agentsWithProfile, (agents) => {
      return this.agentsProfiles(agents);
    });

    // Centralized reactive store for online peer count
    let _prevOnlineCount: number | undefined = undefined;
    this.onlinePeersCount = derived(this._peerStatuses, (peerStatuses) => {
      if (!peerStatuses) return undefined;

      const myPubKeyB64 = encodeHashToBase64(this.groupClient.myPubKey);

      // Count agents with status 'online' or 'inactive', excluding self
      const count = Object.entries(peerStatuses).filter(
        ([pubkeyB64, status]) =>
          pubkeyB64 !== myPubKeyB64 && ['online', 'inactive'].includes(status.status),
      ).length;

      // Only log when the count actually changes
      if (count !== _prevOnlineCount) {
        const totalEntries = Object.keys(peerStatuses).length;
        const statuses = Object.entries(peerStatuses)
          .filter(([k]) => k !== myPubKeyB64)
          .map(([k, v]) => `${k.slice(0, 8)}:${v.status}`)
          .join(', ');
        onlineDebugLog(`[OnlineDebug][${groupIdShort}] onlinePeersCount: ${_prevOnlineCount} -> ${count}, totalEntries=${totalEntries}, statuses=[${statuses}] (instance=${this._instanceId})`);
        _prevOnlineCount = count;
      }

      return count;
    });

    this._ignoredApplets.set(
      this.mossStore.persistedStore.ignoredApplets.value(encodeHashToBase64(groupDnaHash)),
    );

    // Note: Old agent fetching via getAgentsWithProfile removed
    // Now using agentInfo polling instead for faster and more accurate agent discovery

    // Ping agents periodically to determine online/offline status
    // Uses safeSetInterval to prevent call stacking if pings are slow
    this._pingIntervalHandle = safeSetInterval({
      name: 'pingAgents',
      fn: async () => {
        await this.pingAgentsAndCleanPeerStatuses();
      },
      intervalMs: PING_AGENTS_FREQUENCY_MS,
      runImmediately: true,
    });

    // Poll agentInfo to discover agents in network
    // Uses safeSetInterval to prevent call stacking
    this._agentInfoIntervalHandle = safeSetInterval({
      name: 'pollAgentInfo',
      fn: async () => {
        await this.pollAgentInfo();
      },
      intervalMs: GET_AGENT_INFO_FREQUENCY_MS,
      runImmediately: true,
    });

    // Poll asset relations periodically
    // Uses safeSetInterval to prevent call stacking
    this._assetRelationsIntervalHandle = safeSetInterval({
      name: 'pollAssetRelations',
      fn: async () => {
        await this.pollAssetRelations();
      },
      intervalMs: ASSET_RELATION_POLLING_PERIOD,
      runImmediately: false,
    });

    // Handle group dna remote signals
    this._groupSignalUnsub = this.groupClient.onSignal((signal) => {
      if (signal.type === 'Arbitrary') {
        const signalContent = decode(signal.content) as GroupRemoteSignal;
        if (signalContent.type === 'assets-signal') {
          this.assetSignalHandler(signalContent.content, false);
        } else if (signalContent.type === 'applet-signal') {
          this.mossStore.emitParentToAppletMessage(
            {
              type: 'remote-signal-received',
              payload: signalContent.payload,
            },
            [signalContent.appletId],
          );
        }
      }
    });

    this._assetsSignalUnsub = this.assetsClient.onSignal((signal) => this.assetSignalHandler(signal, true));

    this.constructed = true;
  }

  /**
   * Cleanup method to cancel all periodic polling intervals.
   * Should be called when the GroupStore is no longer needed.
   */
  cleanup(): void {
    onlineDebugLog(`[OnlineDebug][${this._groupIdShort}] GroupStore cleanup called (instance=${this._instanceId})`);
    if (this._pingIntervalHandle) {
      this._pingIntervalHandle.cancel();
      this._pingIntervalHandle = undefined;
    }
    if (this._agentInfoIntervalHandle) {
      this._agentInfoIntervalHandle.cancel();
      this._agentInfoIntervalHandle = undefined;
    }
    if (this._assetRelationsIntervalHandle) {
      this._assetRelationsIntervalHandle.cancel();
      this._assetRelationsIntervalHandle = undefined;
    }
    if (this._peerStatusSignalUnsub) {
      this._peerStatusSignalUnsub();
      this._peerStatusSignalUnsub = undefined;
    }
    if (this._groupSignalUnsub) {
      this._groupSignalUnsub();
      this._groupSignalUnsub = undefined;
    }
    if (this._assetsSignalUnsub) {
      this._assetsSignalUnsub();
      this._assetsSignalUnsub = undefined;
    }
  }

  ignoredApplets(): Readable<AppletId[]> {
    return derived(this._ignoredApplets, (a) => a);
  }

  ignoreApplet(appletHash: AppletHash) {
    const groupDnaHashB64 = encodeHashToBase64(this.groupDnaHash);
    let ignoredApplets = this.mossStore.persistedStore.ignoredApplets.value(groupDnaHashB64);
    ignoredApplets.push(encodeHashToBase64(appletHash));
    // deduplicate ignored applets
    ignoredApplets = Array.from(new Set(ignoredApplets));
    this.mossStore.persistedStore.ignoredApplets.set(ignoredApplets, groupDnaHashB64);
    this._ignoredApplets.set(ignoredApplets);
  }

  async assetSignalHandler(signal: SignalPayloadAssets, sendRemote: boolean): Promise<void> {
    // Update asset store(s)
    switch (signal.type) {
      case 'AssetTagsAdded': {
        const walStringified = stringifyWal(walDecodeContext(signal.wal));
        const storeAndSubscribers = this._assetStores[walStringified];
        // If there are no subscribers, we can just drop it here
        if (!storeAndSubscribers) return;
        storeAndSubscribers.store.update((store) => {
          if (store.status !== 'complete') return store;
          store.value.tags = Array.from(new Set([...store.value.tags, ...signal.tags]));
          return store;
        });
        break;
      }
      case 'AssetTagsRemoved': {
        const walStringified = stringifyWal(walDecodeContext(signal.wal));
        const storeAndSubscribers = this._assetStores[walStringified];
        // If there are no subscribers, we can just drop it here
        if (!storeAndSubscribers) return;
        storeAndSubscribers.store.update((store) => {
          if (store.status !== 'complete') return store;
          store.value.tags = store.value.tags.filter((tag) => !signal.tags.includes(tag));
          return store;
        });
        break;
      }
      case 'AssetRelationCreated': {
        const decodedSignal: SignalPayloadAssets = {
          type: 'AssetRelationCreated',
          relation: decodeAssetRelationWALs(signal.relation) as AssetRelationWithTags,
        };
        // Add it to the asset store of the srcWal
        const srcWalStringified = stringifyWal(decodedSignal.relation.src_wal);
        const dstWalStringified = stringifyWal(decodedSignal.relation.dst_wal);
        const srcStoreAndSubscribers = this._assetStores[srcWalStringified];
        const dstStoreAndSubscribers = this._assetStores[dstWalStringified];
        if (srcStoreAndSubscribers) {
          srcStoreAndSubscribers.store.update((store) => {
            if (store.status !== 'complete') return store;
            const existingWalAndTagsIdx = store.value.linkedFrom.findIndex(
              ({ wal }) => stringifyWal(wal) === dstWalStringified,
            );
            if (existingWalAndTagsIdx !== -1) {
              const existingWalAndTags = store.value.linkedFrom[existingWalAndTagsIdx];
              const newTags = dedupStringArray([
                ...existingWalAndTags.tags,
                ...decodedSignal.relation.tags,
              ]);
              // overwrite existing item with the one containing merged tags
              store.value.linkedFrom[existingWalAndTagsIdx] = {
                wal: existingWalAndTags.wal,
                relationHash: existingWalAndTags.relationHash,
                tags: newTags,
                createdAt: existingWalAndTags.createdAt,
              };
            } else {
              store.value.linkedFrom = [
                ...store.value.linkedFrom,
                {
                  wal: decodedSignal.relation.dst_wal,
                  relationHash: decodedSignal.relation.relation_hash,
                  tags: dedupStringArray(decodedSignal.relation.tags),
                  createdAt: decodedSignal.relation.created_at,
                },
              ];
            }
            return store;
          });
        }

        // add it to the asset store of the dstWal
        if (dstStoreAndSubscribers) {
          dstStoreAndSubscribers.store.update((store) => {
            if (store.status !== 'complete') return store;
            // TODO deduplicate
            const existingWalAndTagsIdx = store.value.linkedTo.findIndex(
              ({ wal }) => stringifyWal(wal) === srcWalStringified,
            );
            if (existingWalAndTagsIdx !== -1) {
              const existingWalAndTags = store.value.linkedTo[existingWalAndTagsIdx];
              const newTags = dedupStringArray([
                ...existingWalAndTags.tags,
                ...decodedSignal.relation.tags,
              ]);
              // overwrite existing item with the one containing merged tags
              store.value.linkedTo[existingWalAndTagsIdx] = {
                wal: existingWalAndTags.wal,
                relationHash: existingWalAndTags.relationHash,
                tags: newTags,
                createdAt: existingWalAndTags.createdAt,
              };
            } else {
              store.value.linkedTo = [
                ...store.value.linkedTo,
                {
                  wal: decodedSignal.relation.src_wal,
                  relationHash: decodedSignal.relation.relation_hash,
                  tags: dedupStringArray(decodedSignal.relation.tags),
                  createdAt: decodedSignal.relation.created_at,
                },
              ];
            }
            return store;
          });
        }
        break;
      }
      case 'AssetRelationRemoved': {
        const decodedSignal: SignalPayloadAssets = {
          type: 'AssetRelationRemoved',
          relation: {
            src_wal: walDecodeContext(signal.relation.src_wal),
            dst_wal: walDecodeContext(signal.relation.dst_wal),
            relation_hash: signal.relation.relation_hash,
            created_at: signal.relation.created_at,
          },
        };
        console.log('ASSET RELATION REMOVED!', decodedSignal);
        const srcWalStringified = stringifyWal(decodedSignal.relation.src_wal);
        const dstWalStringified = stringifyWal(decodedSignal.relation.dst_wal);
        const srcStoreAndSubscribers = this._assetStores[srcWalStringified];
        const dstStoreAndSubscribers = this._assetStores[dstWalStringified];
        if (srcStoreAndSubscribers) {
          srcStoreAndSubscribers.store.update((store) => {
            if (store.status !== 'complete') return store;
            store.value.linkedFrom = store.value.linkedFrom.filter(
              ({ wal }) => stringifyWal(wal) !== dstWalStringified,
            );
            return store;
          });
        }
        if (dstStoreAndSubscribers) {
          dstStoreAndSubscribers.store.update((store) => {
            if (store.status !== 'complete') return store;
            store.value.linkedTo = store.value.linkedTo.filter(
              ({ wal }) => stringifyWal(wal) !== srcWalStringified,
            );
            return store;
          });
        }
        break;
      }
      case 'RelationTagsAdded': {
        const decodedSignal: SignalPayloadAssets = {
          type: 'RelationTagsAdded',
          relation_hash: signal.relation_hash,
          src_wal: walDecodeContext(signal.src_wal),
          dst_wal: walDecodeContext(signal.dst_wal),
          tags: signal.tags,
        };
        const srcWalStringified = stringifyWal(decodedSignal.src_wal);
        const dstWalStringified = stringifyWal(decodedSignal.dst_wal);
        const srcStoreAndSubscribers = this._assetStores[srcWalStringified];
        const dstStoreAndSubscribers = this._assetStores[dstWalStringified];

        // Add the new tags to the asset store of the srcWal
        if (srcStoreAndSubscribers) {
          srcStoreAndSubscribers.store.update((store) => {
            if (store.status !== 'complete') return store;
            const existingWalAndTagsIdx = store.value.linkedFrom.findIndex(
              ({ wal }) => stringifyWal(wal) === dstWalStringified,
            );
            if (existingWalAndTagsIdx !== -1) {
              const existingWalAndTags = store.value.linkedFrom[existingWalAndTagsIdx];
              const newTags = dedupStringArray([...existingWalAndTags.tags, ...decodedSignal.tags]);
              // overwrite existing item with the one containing merged tags
              store.value.linkedFrom[existingWalAndTagsIdx] = {
                wal: existingWalAndTags.wal,
                relationHash: existingWalAndTags.relationHash,
                tags: newTags,
                createdAt: existingWalAndTags.createdAt,
              };
            }
            return store;
          });
        }

        // Add the new tags to the asset store of the dstWal
        if (dstStoreAndSubscribers) {
          dstStoreAndSubscribers.store.update((store) => {
            if (store.status !== 'complete') return store;
            // TODO deduplicate
            const existingWalAndTagsIdx = store.value.linkedTo.findIndex(
              ({ wal }) => stringifyWal(wal) === srcWalStringified,
            );
            if (existingWalAndTagsIdx !== -1) {
              const existingWalAndTags = store.value.linkedTo[existingWalAndTagsIdx];
              const newTags = dedupStringArray([...existingWalAndTags.tags, ...decodedSignal.tags]);
              // overwrite existing item with the one containing merged tags
              store.value.linkedTo[existingWalAndTagsIdx] = {
                wal: existingWalAndTags.wal,
                relationHash: existingWalAndTags.relationHash,
                tags: newTags,
                createdAt: existingWalAndTags.createdAt,
              };
            }
            return store;
          });
        }
        break;
      }
      case 'RelationTagsRemoved': {
        const decodedSignal: SignalPayloadAssets = {
          type: 'RelationTagsRemoved',
          relation_hash: signal.relation_hash,
          src_wal: walDecodeContext(signal.src_wal),
          dst_wal: walDecodeContext(signal.dst_wal),
          tags: signal.tags,
        };
        console.log('RelationTagsRemoved: signal: ', signal);
        const srcWalStringified = stringifyWal(decodedSignal.src_wal);
        const dstWalStringified = stringifyWal(decodedSignal.dst_wal);
        const srcStoreAndSubscribers = this._assetStores[srcWalStringified];
        const dstStoreAndSubscribers = this._assetStores[dstWalStringified];

        // Remove tags from asset store of the srcWal
        if (srcStoreAndSubscribers) {
          srcStoreAndSubscribers.store.update((store) => {
            if (store.status !== 'complete') return store;
            const existingWalAndTagsIdx = store.value.linkedFrom.findIndex(
              ({ wal }) => stringifyWal(wal) === dstWalStringified,
            );
            if (existingWalAndTagsIdx !== -1) {
              const existingWalAndTags = store.value.linkedFrom[existingWalAndTagsIdx];
              const newTags = existingWalAndTags.tags.filter(
                (tag) => !decodedSignal.tags.includes(tag),
              );
              // overwrite existing item with the one containing merged tags
              store.value.linkedFrom[existingWalAndTagsIdx] = {
                wal: existingWalAndTags.wal,
                relationHash: existingWalAndTags.relationHash,
                tags: newTags,
                createdAt: existingWalAndTags.createdAt,
              };
            }
            return store;
          });
        }

        // Remove tags from asset store of the dstWal
        if (dstStoreAndSubscribers) {
          dstStoreAndSubscribers.store.update((store) => {
            if (store.status !== 'complete') return store;
            // TODO deduplicate
            const existingWalAndTagsIdx = store.value.linkedTo.findIndex(
              ({ wal }) => stringifyWal(wal) === srcWalStringified,
            );
            if (existingWalAndTagsIdx !== -1) {
              const existingWalAndTags = store.value.linkedTo[existingWalAndTagsIdx];
              const newTags = existingWalAndTags.tags.filter(
                (tag) => !decodedSignal.tags.includes(tag),
              );
              // overwrite existing item with the one containing merged tags
              store.value.linkedTo[existingWalAndTagsIdx] = {
                wal: existingWalAndTags.wal,
                relationHash: existingWalAndTags.relationHash,
                tags: newTags,
                createdAt: existingWalAndTags.createdAt,
              };
            }
            return store;
          });
        }
        break;
      }
    }

    if (sendRemote) {
      // Send remote signal
      const peerStatuses = get(this.peerStatuses());
      if (peerStatuses) {
        const peersToSendSignal = Object.entries(peerStatuses)
          .filter(
            ([pubkeyB64, status]) =>
              status.lastSeen > Date.now() - OFFLINE_THRESHOLD &&
              pubkeyB64 !== encodeHashToBase64(this.groupClient.myPubKey),
          )
          .map(([pubkeyB64, _]) => decodeHashFromBase64(pubkeyB64));

        await this.groupClient.remoteSignalArbitrary(
          {
            type: 'assets-signal',
            content: signal,
          },
          peersToSendSignal,
        );
      }
    }

    await this.allAssetRelations.reload();
  }

  /**
   * This function is here to be called when an AppletToParent request
   * of type 'subscribe-to-asset-store' is received from an iframe.
   *
   * @param wal
   * @param appletIds
   */
  subscribeToAssetStore(wal: WAL, appletIds: AppletId[]) {
    const walStringified = stringifyWal(wal);
    let storeAndSubscribers = this._assetStores[walStringified];
    if (!storeAndSubscribers) {
      storeAndSubscribers = {
        subscriberCounts: {},
        store: writable({ status: 'pending' }),
        unsubscribe: undefined,
      };
      appletIds.forEach((id) => {
        storeAndSubscribers.subscriberCounts[id] = 1;
      });
      this._assetStores[walStringified] = storeAndSubscribers;
      // subscribe to the store to send a message to all iframe messages whenever
      // the value changes
      const unsubscribe = storeAndSubscribers.store.subscribe((asyncStatus) => {
        const appletIds = Object.entries(this._assetStores[walStringified].subscriberCounts)
          .filter(([_appletId, count]) => count > 0)
          .map(([appletId, _]) => appletId);
        this.mossStore.emitParentToAppletMessage(
          {
            type: 'asset-store-update',
            value: asyncStatus,
            walStringified,
          },
          appletIds,
        );
      });
      storeAndSubscribers.unsubscribe = unsubscribe;
      // poll current value
      setTimeout(async () => {
        const relationsForWal = await this.assetsClient.getAllRelationsForWal(wal);
        const linkedTo = relationsForWal.linked_to.map((v) => ({
          wal: v.dst_wal,
          tags: dedupStringArray(v.tags),
          relationHash: v.relation_hash,
          createdAt: v.created_at,
        }));
        const linkedFrom = relationsForWal.linked_from.map((v) => ({
          wal: v.dst_wal,
          tags: dedupStringArray(v.tags),
          relationHash: v.relation_hash,
          createdAt: v.created_at,
        }));
        storeAndSubscribers.store.set({
          status: 'complete',
          value: { tags: dedupStringArray(relationsForWal.tags), linkedFrom, linkedTo },
        });
      });
    } else {
      // Add the new subscriber to the list of subscribers
      appletIds.forEach((id) => {
        const currentSubscriberCounts = storeAndSubscribers.subscriberCounts[id];
        if (!currentSubscriberCounts || currentSubscriberCounts < 0) {
          storeAndSubscribers.subscriberCounts[id] = 0;
        }
        storeAndSubscribers.subscriberCounts[id] += 1;
      });
      // Send message to iframes with updated value
      this.mossStore.emitParentToAppletMessage(
        {
          type: 'asset-store-update',
          value: get(storeAndSubscribers.store),
          walStringified,
        },
        appletIds,
      );
    }
  }

  /**
   * This function is here to be called when an AppletToParent request
   * of type 'unsubscribe-from-asset-store' is received from an iframe.
   *
   * @param wal
   */
  unsubscribeFromAssetStore(wal: WAL, appletId: AppletId) {
    const walStringified = stringifyWal(wal);
    // Reduce the subscriber count
    const storeAndSubscribers = this._assetStores[walStringified];
    if (!storeAndSubscribers) return;
    if (storeAndSubscribers.subscriberCounts[appletId]) {
      storeAndSubscribers.subscriberCounts[appletId] -= 1;
      // If the overall subscriber count is zero, unsbscribe from and remove the store
      const overallCount = Object.values(storeAndSubscribers.subscriberCounts).reduce(
        (acc, currentVal) => acc + currentVal,
        0,
      );
      if (overallCount < 1) {
        if (storeAndSubscribers.unsubscribe) storeAndSubscribers.unsubscribe();
        delete this._assetStores[walStringified];
      }
    }
  }

  /**
   * Contains all asset relations for that group. Gets reloaded whenever a
   * a asset signal arrives or when the asset graph view is selected
   */
  allAssetRelations = lazyReloadableStore(async () =>
    this.assetsClient.getAllAssetRelationsWithTags(),
  );

  allAssetRelationTags = pipe(this.allAssetRelations, (assetRelations) => {
    return dedupStringArray(assetRelations.map((assetRelation) => assetRelation.tags).flat());
  });

  async groupDnaModifiers(): Promise<DnaModifiers> {
    const appInfo = await this.appWebsocket.appInfo();
    const cellInfo = appInfo.cell_info['group'].find(
      (cellInfo) => cellInfo.type === CellType.Provisioned,
    );

    if (!cellInfo) throw new Error('Could not find cell for this group');

    return cellInfo.value.dna_modifiers;
  }

  modifiers = lazyLoad(async () => {
    const dnaModifiers = await this.groupDnaModifiers();
    return dnaModifiers;
  });

  myAccountabilities = lazyReloadableStore(async () => this.groupClient.getMyAccountabilities());

  allAgentsAccountabilities = lazyReloadableStore(async () =>
    this.groupClient.getAllAgentsAccountabilities(),
  );

  agentAccountabilities = new LazyHoloHashMap((agent) =>
    lazyLoad(() => this.groupClient.getAgentAccountabilities(agent)),
  );

  groupProfile = reloadableLazyLoadAndPollUntil(
    async () => {
      // only poll in case groupProfile is not yet defined
      const entryRecord = await this.groupClient.getGroupProfile(true);
      return entryRecord?.entry;
    },
    undefined,
    3000,
    'Failed to fetch group profile',
    async () => {
      // only poll in case groupProfile is not yet defined
      const entryRecord = await this.groupClient.getGroupProfile(true);
      return entryRecord?.entry;
    },
  );

  groupDescription = reloadableLazyLoadAndPollUntil(
    async () => {
      const entryRecord = await this.groupClient.getGroupDescription(true);
      return entryRecord?.entry;
    },
    undefined,
    10000,
    'Failed to get group description',
    async () => {
      const entryRecord = await this.groupClient.getGroupDescription(true);
      return entryRecord?.entry;
    },
  );

  groupAppletsMetaData = lazyReloadableStore(async () =>
    this.groupClient.getGroupAppletsMetaData(),
  );

  agentsProfiles(
    agents: Array<AgentPubKey>,
  ): AsyncReadable<ReadonlyMap<AgentPubKey, MaybeProfile>> {
    return sliceAndJoin(this.membersProfiles as GetonlyMap<any, any>, agents);
  }

  membersProfiles = new LazyHoloHashMap((agent: AgentPubKey) =>
    asyncReadable<MaybeProfile | undefined>(async (set) => {
      try {
        console.log('Getting agent profile.');
        const profile = await this.profilesStore.client.getAgentProfile(agent, true);
        profile ? set({ type: 'profile', profile }) : set({ type: 'unknown' });
      } catch (e) {
        console.error('Failed to fetch profile: ', e);
        set({ type: 'unknown' });
      }

      return this.profilesStore.client.onSignal((signal) => {
        if (
          encodeHashToBase64(this.profilesStore.client.client.myPubKey) !==
          encodeHashToBase64(agent)
        )
          return;
        if (!(signal.type === 'EntryCreated' || signal.type === 'EntryUpdated')) return;
        const record = new EntryRecord<Profile>({
          entry: {
            Present: {
              entry_type: 'App',
              entry: encode(signal.app_entry),
            },
          },
          signed_action: signal.action,
        });
        set({ type: 'profile', profile: record });
      });
    }),
  );

  peerStatuses(): Readable<Record<AgentPubKeyB64, PeerStatus> | undefined> {
    return derived(this._peerStatuses, (state) => state);
  }

  updatePeerStatus(agent: AgentPubKey, status: string, tzUtcOffset?: number) {
    this._peerStatuses.update((value) => {
      // Create a new object to ensure derived stores detect the change
      const newValue = value ? { ...value } : {};
      newValue[encodeHashToBase64(agent)] = {
        lastSeen: Date.now(),
        status,
        tzUtcOffset,
      };
      return newValue;
    });
  }

  /**
   * Get the current unread group notification counts.
   * Returns a readable store with counts by urgency level.
   */
  unreadGroupNotifications(): Readable<{ low: number; medium: number; high: number }> {
    return derived(this._unreadGroupNotifications, (state) => state);
  }

  /**
   * Get the notification state as [urgency, count] tuple for display.
   * Returns the highest urgency level with its count.
   */
  getUnreadGroupNotificationState(): [string | undefined, number | undefined] {
    const counts = get(this._unreadGroupNotifications);
    if (counts.high > 0) {
      return ['high', counts.high];
    } else if (counts.medium > 0) {
      return ['medium', counts.medium];
    } else if (counts.low > 0) {
      return ['low', counts.low];
    }
    return [undefined, undefined];
  }

  /**
   * Increment the unread notification count for the given urgency level.
   * Used for ephemeral notifications like foyer messages.
   */
  incrementUnreadGroupNotifications(urgency: 'low' | 'medium' | 'high') {
    this._unreadGroupNotifications.update((counts) => ({
      ...counts,
      [urgency]: counts[urgency] + 1,
    }));
  }

  /**
   * Clear all unread group notifications.
   * Called when the user views the group/foyer.
   */
  clearGroupNotificationStatus() {
    this._unreadGroupNotifications.set({ low: 0, medium: 0, high: 0 });
  }

  /**
   * Get the foyer notification settings for this group.
   */
  getFoyerNotificationSettings(): Readable<FoyerNotificationSettings> {
    return derived(this._foyerNotificationSettings, (settings) => settings);
  }

  /**
   * Get the current foyer notification settings value.
   */
  getFoyerNotificationSettingsValue(): FoyerNotificationSettings {
    return get(this._foyerNotificationSettings);
  }

  /**
   * Set the foyer notification settings for this group.
   * Persists to localStorage.
   */
  setFoyerNotificationSettings(settings: FoyerNotificationSettings) {
    this._foyerNotificationSettings.set(settings);
    const key = `foyerNotificationSettings-${encodeHashToBase64(this.groupDnaHash)}`;
    localStorage.setItem(key, JSON.stringify(settings));
  }

  /**
   * Load the foyer notification settings from localStorage.
   * Called during initialization. Handles migration from old format.
   */
  loadFoyerNotificationSettings() {
    const newKey = `foyerNotificationSettings-${encodeHashToBase64(this.groupDnaHash)}`;
    const oldKey = `foyerNotificationSetting-${encodeHashToBase64(this.groupDnaHash)}`;

    // Try new format first
    const storedNew = localStorage.getItem(newKey);
    if (storedNew) {
      try {
        const parsed = JSON.parse(storedNew) as FoyerNotificationSettings;
        if (parsed.mentions !== undefined && parsed.allMessages !== undefined) {
          this._foyerNotificationSettings.set(parsed);
          return;
        }
      } catch {
        // Invalid JSON, fall through to migration
      }
    }

    // Migrate from old format if present
    const storedOld = localStorage.getItem(oldKey);
    if (storedOld) {
      let migratedSettings: FoyerNotificationSettings;
      switch (storedOld) {
        case 'all':
          migratedSettings = { mentions: 'high', allMessages: 'high' };
          break;
        case 'mentions':
          migratedSettings = { mentions: 'high', allMessages: 'none' };
          break;
        case 'none':
          migratedSettings = { mentions: 'none', allMessages: 'none' };
          break;
        default:
          migratedSettings = DEFAULT_FOYER_NOTIFICATION_SETTINGS;
      }
      this._foyerNotificationSettings.set(migratedSettings);
      // Save in new format and remove old key
      localStorage.setItem(newKey, JSON.stringify(migratedSettings));
      localStorage.removeItem(oldKey);
    }
  }

  /**
   * Reconstruct full AgentPubKey from partial agent ID returned by agentInfo.
   * AgentInfo returns only the middle 32 bytes (core hash) as URL-safe base64.
   * Uses hashFrom32AndType to properly construct the full 39-byte hash.
   */
  private getFullAgentId(partialAgentIdB64: string): AgentPubKey {
    // Decode URL-safe base64 to Uint8Array
    // Convert URL-safe base64 to standard base64
    let standardBase64 = partialAgentIdB64.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if needed
    while (standardBase64.length % 4 !== 0) {
      standardBase64 += '=';
    }

    const binaryString = atob(standardBase64);
    const coreHash = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      coreHash[i] = binaryString.charCodeAt(i);
    }

    // Use hashFrom32AndType to construct the full AgentPubKey
    return hashFrom32AndType(coreHash, HoloHashType.Agent) as AgentPubKey;
  }

  /**
   * Poll Holochain's agentInfo to discover which agents are in the network.
   * This does NOT indicate online/offline status - only network membership.
   * Ping/pong signals determine actual online status.
   */
  async pollAgentInfo(): Promise<void> {
    try {
      const appWebsocket = this.appWebsocket;
      const response = await appWebsocket.agentInfo({
        dna_hashes: [this.groupDnaHash],
      });

      // Extract partial agent IDs and reconstruct full agent keys
      const knownAgents = new Set<AgentPubKeyB64>();
      const myPubKeyB64 = encodeHashToBase64(this.groupClient.myPubKey);

      for (const agentInfoItem of response) {
        try {
          // Response format: { agentInfo: "{...json...}", signature: "..." }
          // Parse the outer structure
          const parsed =
            typeof agentInfoItem === 'string' ? JSON.parse(agentInfoItem) : agentInfoItem;

          // Parse the inner agentInfo JSON string
          const agentInfoData =
            typeof parsed.agentInfo === 'string'
              ? JSON.parse(parsed.agentInfo)
              : parsed.agentInfo;

          // Extract the partial agent ID from the 'agent' field
          const partialAgentId = agentInfoData.agent;

          if (!partialAgentId) {
            console.warn('[AgentInfo] No agent field in agentInfo data:', agentInfoData);
            continue;
          }

          // Reconstruct full agent key from partial ID
          const fullAgentKey = this.getFullAgentId(partialAgentId);
          const fullAgentKeyB64 = encodeHashToBase64(fullAgentKey);

          // Exclude self
          if (fullAgentKeyB64 !== myPubKeyB64) {
            knownAgents.add(fullAgentKeyB64);
          }
        } catch (error) {
          console.warn('[AgentInfo] Failed to parse agent info item:', agentInfoItem, error);
        }
      }

      const prevSize = get(this._knownAgents).size;
      this._knownAgents.set(knownAgents);
      const currentOnlineCount = get(this.onlinePeersCount);
      onlineDebugLog(`[OnlineDebug][${this._groupIdShort}] pollAgentInfo: knownAgents ${prevSize} -> ${knownAgents.size}, onlineCount=${currentOnlineCount} (instance=${this._instanceId})`);
    } catch (error) {
      onlineDebugLog(`[OnlineDebug][${this._groupIdShort}] Failed to poll agent info (instance=${this._instanceId}):`, error);
      // Don't throw - if agentInfo fails, signaling will likely fail too
      // Just keep using the last known agent list
    }
  }

  /**
   * Poll asset relations for all active asset stores.
   * Only polls for stores that have active subscribers.
   */
  async pollAssetRelations(): Promise<void> {
    const walsToPoll = Object.entries(this._assetStores)
      .filter(([_, storeAndSubscribers]) => {
        // We only poll for stores with active subscribers
        return (
          Object.values(storeAndSubscribers.subscriberCounts).reduce(
            (acc, currentVal) => acc + currentVal,
            0,
          ) > 0
        );
      })
      .map(([stringifiedWal, _]) => deStringifyWal(stringifiedWal));

    if (walsToPoll.length === 0) return;

    const relations = await this.assetsClient.batchGetAllRelationsForWal(walsToPoll);
    relations.forEach((relationsForWal) => {
      const walStringified = stringifyWal(relationsForWal.wal);
      const storeAndSubscribers = this._assetStores[walStringified];
      if (!storeAndSubscribers) {
        console.warn('storeAndSubscribers undefined for stringified WAL: ', walStringified);
        return;
      }
      const linkedTo = relationsForWal.linked_to.map((v) => ({
        wal: v.dst_wal,
        tags: dedupStringArray(v.tags),
        relationHash: v.relation_hash,
        createdAt: v.created_at,
      }));
      const linkedFrom = relationsForWal.linked_from.map((v) => ({
        wal: v.dst_wal,
        tags: dedupStringArray(v.tags),
        relationHash: v.relation_hash,
        createdAt: v.created_at,
      }));
      const newValue = {
        status: 'complete',
        value: { tags: dedupStringArray(relationsForWal.tags), linkedFrom, linkedTo },
      };
      if (!isEqual(newValue, get(storeAndSubscribers.store))) {
        storeAndSubscribers.store.set({
          status: 'complete',
          value: { tags: dedupStringArray(relationsForWal.tags), linkedFrom, linkedTo },
        });
      }
    });
  }

  async pingAgentsAndCleanPeerStatuses() {
    const now = Date.now();
    let markedOfflineCount = 0;
    // Set unresponsive agents to offline
    this._peerStatuses.update((statuses) => {
      // Create a new object to ensure derived stores detect the change
      const newStatuses = statuses ? { ...statuses } : {};

      Object.keys(newStatuses).forEach((agent) => {
        if (now - newStatuses[agent].lastSeen > OFFLINE_THRESHOLD) {
          if (newStatuses[agent].status !== 'offline') {
            markedOfflineCount++;
          }
          newStatuses[agent] = {
            lastSeen: newStatuses[agent].lastSeen,
            status: 'offline',
          };
        }
      });
      // Don't add self to peer statuses - peer statuses should only track other agents
      return newStatuses;
    });
    const knownAgentsCount = get(this._knownAgents).size;
    onlineDebugLog(`[OnlineDebug][${this._groupIdShort}] pingClean: markedOffline=${markedOfflineCount}, pinging ${knownAgentsCount} known agents (instance=${this._instanceId})`);
    await this.pingAgents();
  }

  /**
   * Pings all agents discovered via agentInfo.
   * Self is already excluded from the knownAgents set by pollAgentInfo().
   * Since agentInfo only returns agents in the network, we ping all of them
   * to determine their actual online/offline status.
   */
  async pingAgents(): Promise<void> {
    const now = Date.now();
    const myStatus = now - this.mossStore.myLatestActivity > IDLE_THRESHOLD
      ? 'inactive'
      : 'online';
    const tzOffset = this.mossStore.tzUtcOffset();

    // Get agents that Holochain knows about in the network (self already excluded)
    const knownAgentsB64 = Array.from(get(this._knownAgents));
    const knownAgents = knownAgentsB64.map((b64) => decodeHashFromBase64(b64));

    return knownAgents.length > 0
      ? this.peerStatusClient.ping(knownAgents, myStatus, tzOffset)
      : Promise.resolve();
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

    const distributionInfo: DistributionInfo = JSON.parse(applet.distribution_info);
    Value.Assert(TDistributionInfo, distributionInfo);

    if (distributionInfo.type !== 'web2-tool-list')
      throw new Error("Tool source types other than 'web2-tool-list' are currently not supported.");

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
  }

  /**
   * Fetches the tool from the devhub, installs it in the current conductor
   * and advertises it in the group DNA. To be called by the first agent
   * installing this specific instance of the Applet.
   * This function can only successfully be called by the Progenitor or
   * Stewards.
   */
  async installAndAdvertiseApplet(
    tool: ToolAndCurationInfo,
    customName: string,
    networkSeed?: string,
    permissionHash?: ActionHash,
  ): Promise<EntryHash> {
    if (!networkSeed) {
      networkSeed = uuidv4();
    }

    const latestVersion = tool.latestVersion;
    if (!latestVersion.hashes.webhappSha256) throw new Error('webhappSha256 not defined.');
    if (!latestVersion.hashes.happSha256) throw new Error('happSha256 not defined.');
    if (!latestVersion.hashes.uiSha256) throw new Error('uiSha256 not defined.');

    const distributionInfo: DistributionInfo = {
      type: 'web2-tool-list',
      info: {
        developerCollectiveId: tool.developerCollectiveId,
        toolListUrl: tool.toolListUrl,
        toolId: tool.toolInfoAndVersions.id,
        toolName: tool.toolInfoAndVersions.title,
        versionBranch: tool.toolInfoAndVersions.versionBranch,
        toolVersion: latestVersion.version,
        toolCompatibilityId: deriveToolCompatibilityId({
          toolListUrl: tool.toolListUrl,
          toolId: tool.toolInfoAndVersions.id,
          versionBranch: tool.toolInfoAndVersions.versionBranch,
        }),
      },
    };

    console.log('INSTALLING WITH distributionInfo: ', distributionInfo);

    const applet: Applet = {
      permission_hash: permissionHash,
      custom_name: customName,
      description: tool.toolInfoAndVersions.description,
      subtitle: tool.toolInfoAndVersions.subtitle,
      sha256_happ: latestVersion.hashes.happSha256,
      sha256_ui: latestVersion.hashes.uiSha256,
      sha256_webhapp: latestVersion.hashes.webhappSha256,
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

  applets: LazyHoloHashMap<AppletHash, AsyncReadable<Applet | undefined>> = new LazyHoloHashMap((appletHash: EntryHash) =>
    lazyLoad(async () => this.groupClient.getApplet(appletHash)),
  );

  // Shared polling store for joined applet agents, keyed by applet hash.
  // All UI components subscribe to this instead of creating their own polls.
  joinedAppletAgents: LazyHoloHashMap<AppletHash, AsyncReadable<AppletAgent[]>> =
    new LazyHoloHashMap((appletHash: EntryHash) =>
      lazyLoadAndPoll(
        () => this.groupClient.getJoinedAppletAgents(appletHash),
        20000,
        () => this.groupClient.getJoinedAppletAgents(appletHash, true),
      ),
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
    // console.log(
    //   'Got allMyRunningApplets: ',
    //   output.map((h) => encodeHashToBase64(h)),
    // );
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
    return this.groupClient.getGroupApplets();
  });

  // Applets that have been registered in the group by someone else but have never been installed
  // in the local conductor yet (provided that storing the Applet entry to the local source chain has
  // succeeded for every Applet that has been installed into the conductor)
  unjoinedApplets = lazyLoadAndPoll(async () => {
    const unjoinedApplets = await this.groupClient.getUnjoinedApplets(true);
    const result: EntryHashMap<[AgentPubKey, number]> = new EntryHashMap();
    unjoinedApplets.forEach(([appletHash, addingAgent, timestamp]) => {
      result.set(appletHash, [addingAgent, timestamp]);
    });
    return result;
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
  //           encodeHashToBase64(installedAppletHash) === encodeHashToBase64(appletHash)
  //       )
  //     )
  // );

  activeAppletStores: AsyncReadable<HoloHashMap<EntryHash, AppletStore>> = pipe(
        this.allMyRunningApplets,
        (allApplets) => sliceAndJoin(this.mossStore.appletStores as GetonlyMap<any, any>, allApplets),
  );

  allBlocks = pipe(this.activeAppletStores, (appletsStores) =>
    mapAndJoin(appletsStores, (s) => s.blocks),
  );

  allUnreadNotifications = pipe(
    this.activeAppletStores,
    (allAppletStores) =>
      derived(
        [
          joinMap(mapValues(allAppletStores, (store) => store.unreadNotifications())),
          this._unreadGroupNotifications,
        ] as const,
        ([map, groupCounts]) =>
          ({
            status: 'complete',
            value: { appletNotifications: map, groupCounts },
          }) as AsyncStatus<{
            appletNotifications: ReadonlyMap<Uint8Array, [string | undefined, number | undefined]>;
            groupCounts: { low: number; medium: number; high: number };
          }>,
      ),
    ({ appletNotifications, groupCounts }) => {
      // Aggregate applet notification counts
      const notificationCounts = { low: 0, medium: 0, high: 0 };
      Array.from(appletNotifications.values()).forEach(([urgency, count]) => {
        if (urgency) notificationCounts[urgency] += count;
      });

      // Merge in foyer/group-level notification counts
      notificationCounts.low += groupCounts.low;
      notificationCounts.medium += groupCounts.medium;
      notificationCounts.high += groupCounts.high;

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

  async emitToGroupApplets(message: ParentToAppletMessage): Promise<void> {
    const appletHashes = await toPromise(this.allMyRunningApplets);
    // __PERFORMANCE__ TODO possibly store base64 versions of hashes already in group store
    // instead of encoding each time
    await this.mossStore.emitParentToAppletMessage(
      message,
      appletHashes.map((hash) => encodeHashToBase64(hash)),
    );
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

import { EntryRecord, isSignalFromCellWithRole } from '@holochain-open-dev/utils';
import {
  EntryHash,
  Record,
  AppWebsocket,
  AgentPubKey,
  encodeHashToBase64,
  InstalledAppId,
  AppAuthenticationToken,
  ActionHash,
  RoleNameCallZomeRequest, Timestamp
} from '@holochain/client';
import { AppletHash, UnsubscribeFunction } from '@theweave/api';
import { encode } from '@msgpack/msgpack';

import {
  Applet,
  AppletAgent,
  GROUP_APPLETS_META_DATA_NAME,
  GROUP_DESCRIPTION_NAME,
  GroupAppletsMetaData,
  GroupMetaData,
  JoinAppletInput,
  AppletEntryPrivate,
  StewardPermission,
  AppletClonedCell,
  GroupRemoteSignal,
  SignalPayloadGroup,
  GroupProfile, Accountability
} from './types.js';

export class GroupClient {
  constructor(
    public appClient: AppWebsocket,
    public authenticationToken: AppAuthenticationToken,
    public roleName: string,
    public zomeName: string = 'group',
  ) { }

  get myPubKey(): AgentPubKey {
    return this.appClient.myPubKey;
  }

  get installedAppId(): InstalledAppId {
    return this.appClient.installedAppId;
  }

  onSignal(listener: (eventData: SignalPayloadGroup) => void | Promise<void>): UnsubscribeFunction {
    return this.appClient.on('signal', async (signal) => {
      if (
        signal.type === 'app' &&
        (await isSignalFromCellWithRole(this.appClient, this.roleName, signal.value)) &&
        this.zomeName === signal.value.zome_name
      ) {
        listener(signal.value.payload as SignalPayloadGroup);
      }
    });
  }

  /**
   * =============================================================================================
   * Group Profile
   * =============================================================================================
   */

  /**
   *
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getGroupProfile(local: boolean): Promise<EntryRecord<GroupProfile> | undefined> {
    const record = await this.callZome<Record | undefined>('get_group_profile', {
      input: null,
      local,
    });
    return record ? new EntryRecord(record) : undefined;
  }

  async setGroupProfile(groupProfile: GroupProfile): Promise<void> {
    await this.callZome('set_group_profile', groupProfile);
  }

  /**
   * =============================================================================================
   * Applets
   * =============================================================================================
   */

  /**
   *
   * @param appletHash
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getPublicApplet(
    appletHash: AppletHash,
    local: boolean = true,
  ): Promise<EntryRecord<Applet> | undefined> {
    const response: Record | undefined = await this.callZome('get_public_applet', {
      input: appletHash,
      local,
    });
    if (response) {
      return new EntryRecord(response);
    }
    return undefined;
  }

  /**
   *
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getGroupApplets(local: boolean = true): Promise<Array<EntryHash>> {
    return this.callZome('get_group_applets', { input: null, local });
  }

  /**
   * Gets all the private Applet entries from the source chain
   * @returns
   */
  async getMyJoinedApplets(): Promise<Array<AppletEntryPrivate>> {
    return this.callZome('get_my_joined_applets', null);
  }

  /**
   * Gets all the private Applet entries from the source chain
   * @returns
   */
  async getMyJoinedAppletsHashes(): Promise<Array<AppletHash>> {
    const applets: Array<AppletEntryPrivate> = await this.callZome('get_my_joined_applets', null);
    return applets.map((applet) => applet.public_entry_hash);
  }

  /**
   * Gets Applet entries that have been advertised by other agents in the
   * group but have never been installed into the local conductor yet.
   *
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getUnjoinedApplets(local: boolean = true): Promise<Array<[EntryHash, AgentPubKey, number]>> {
    return this.callZome('get_unjoined_applets', { input: null, local });
  }

  /**
   * Gets Applet entries that have been advertised by other agents in the
   * group but have never been installed into the local conductor yet.
   *
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getUnjoinedArchivedApplets(local: boolean = true): Promise<Array<EntryHash>> {
    return this.callZome('get_unjoined_archived_applets', { input: null, local });
  }

  /**
   *
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getArchivedApplets(local: boolean = true): Promise<Array<EntryHash>> {
    return this.callZome('get_archived_applets', { input: null, local });
  }

  /**
   *
   * @param appletHash
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getApplet(appletHash: EntryHash, local: boolean = true): Promise<Applet | undefined> {
    const maybeApplet = await this.callZome<Applet | undefined>('get_applet', {
      input: appletHash,
      local,
    });
    if (!maybeApplet) {
      console.warn(
        `@group-client: @getApplet: No applet found for hash: ${encodeHashToBase64(appletHash)}`,
      );
      return undefined;
    }
    return maybeApplet;
  }

  /**
   *
   * @param appletHash
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getJoinedAppletAgents(appletHash: EntryHash, local: boolean = true): Promise<Array<AppletAgent>> {
    return this.callZome('get_joined_applet_agents', { input: appletHash, local });
  }

  /**
   *
   * @param appletHash
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getAbandonedAppletAgents(
    appletHash: EntryHash,
    local: boolean = true,
  ): Promise<Array<AppletAgent>> {
    return this.callZome('get_abandoned_applet_agents', { input: appletHash, local });
  }

  /**
   * Advertises the Applet in the group DNA, adds the Applet entry as a private
   * entry to the source chain and creates links from the applet to the public
   * key.
   * Can only be called by the Progenitor or Stewards.
   * @param applet
   */
  async registerAndJoinApplet(input: JoinAppletInput): Promise<EntryHash> {
    return this.callZome('register_and_join_applet', input);
  }

  /**
   * Advertises the Applet in the group DNA. Can only be called by the Progenitor or
   * Stewards.
   * @param applet
   */
  async registerApplet(input: Applet): Promise<EntryHash> {
    return this.callZome('register_applet', input);
  }

  /**
   * Adds the Applet entry as a private entry to the source chain and creates
   * links from the applet to the public key.
   * @param applet
   */
  async joinApplet(input: JoinAppletInput): Promise<EntryHash> {
    return this.callZome('join_applet', input);
  }

  /**
   * Should be called after an applet has been uninstalled to signal to other peers
   * that the applet has been abandoned.
   *
   * @param appletHash
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async abandonApplet(appletHash: AppletHash, local: boolean = true): Promise<void> {
    return this.callZome('abandon_applet', { input: appletHash, local });
  }

  async hashApplet(applet: Applet): Promise<EntryHash> {
    return this.callZome('hash_applet', applet);
  }

  /**
   *
   * @param appletHash
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async archiveApplet(appletHash: EntryHash, local: boolean = true): Promise<void> {
    return this.callZome('archive_applet', { input: appletHash, local });
  }

  async unarchiveApplet(appletHash: EntryHash): Promise<void> {
    return this.callZome('unarchive_applet', appletHash);
  }

  /**
   * =============================================================================================
   * Steward permissions
   * =============================================================================================
   */

  /**
   *
   * @param input
   * @returns
   */
  async createStewardPermission(input: StewardPermission): Promise<EntryRecord<StewardPermission>> {
    const response: Record = await this.callZome('create_steward_permission', input);
    return new EntryRecord(response);
  }

  /**
   *
   * @param permissionHash
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getStewardPermission(
    permissionHash: AppletHash,
    local: boolean = true,
  ): Promise<EntryRecord<StewardPermission> | undefined> {
    const response: Record | undefined = await this.callZome('get_steward_permission', {
      input: permissionHash,
      local,
    });
    if (response) {
      return new EntryRecord(response);
    }
    return undefined;
  }

  /**
   * @param ts Timestamp in ms since the Unix Epoch.
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getMyAccountabilities(ts?: Timestamp, local: boolean = true): Promise<Accountability[]> {
    let timestamp = ts? ts : Date.now();
    return this.callZome('get_my_accountabilities', { input: timestamp * 1000, local });
  }

  /**
   *
   * @param agent
   * @param ts Timestamp in ms since the Unix Epoch.
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getAgentAccountabilities(agent: AgentPubKey, ts?: Timestamp, local: boolean = true): Promise<Accountability[]> {
    let timestamp = ts? ts : Date.now();
    return this.callZome('get_agent_accountabilities', { input: [agent, timestamp], local });
  }

  /**
   * @param ts Timestamp in ms since the Unix Epoch.
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getAllAgentsAccountabilities(
    ts?: Timestamp,
    local: boolean = true,
  ): Promise<Array<[AgentPubKey, Accountability]> | undefined> {
    let timestamp = ts? ts : Date.now();
    return this.callZome('get_all_agents_accountabilities', { input: timestamp, local });
  }

  /**
   * =============================================================================================
   * Group Metadata
   * =============================================================================================
   */

  async setGroupDescription(
    permissionHash: ActionHash | undefined,
    content: string,
  ): Promise<EntryRecord<GroupMetaData>> {
    return this.setGroupMetaData({
      permission_hash: permissionHash,
      name: GROUP_DESCRIPTION_NAME,
      data: content,
    });
  }

  /**
   *
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getGroupDescription(local: boolean = true): Promise<EntryRecord<GroupMetaData> | undefined> {
    return this.getGroupMetaData(GROUP_DESCRIPTION_NAME, local);
  }

  async setGroupAppletsMetaData(
    permissionHash: ActionHash | undefined,
    content: GroupAppletsMetaData,
  ): Promise<EntryRecord<GroupMetaData>> {
    return this.setGroupMetaData({
      permission_hash: permissionHash,
      name: GROUP_APPLETS_META_DATA_NAME,
      data: JSON.stringify(content),
    });
  }

  /**
   *
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getGroupAppletsMetaData(local: boolean = true): Promise<GroupAppletsMetaData | undefined> {
    const metaDataRecord = await this.getGroupMetaData(GROUP_APPLETS_META_DATA_NAME, local);
    const maybeAppletsMetadata = metaDataRecord?.entry.data;
    if (!maybeAppletsMetadata) return undefined;
    return JSON.parse(maybeAppletsMetadata);
  }

  async getGroupMetaData(
    name: string,
    local: boolean = true,
  ): Promise<EntryRecord<GroupMetaData> | undefined> {
    const record = await this.callZome<Record | undefined>('get_group_meta_data', {
      input: name,
      local,
    });
    return record ? new EntryRecord(record) : undefined;
  }

  async setGroupMetaData(metaData: GroupMetaData): Promise<EntryRecord<GroupMetaData>> {
    const record = await this.callZome<Record>('set_group_meta_data', metaData);
    return new EntryRecord(record);
  }

  /**
   * =============================================================================================
   * Cloned Cells
   * =============================================================================================
   */

  /**
   *
   * @param input
   * @param local Whether to use GetOptions::local() (a get request is made here to check
   * whether an `AppletClonedCell` entry had already been created by someone else and this
   * get request can potentially fail over the network)
   * @returns
   */
  async joinClonedCell(input: AppletClonedCell, local: boolean = true): Promise<EntryHash> {
    return this.callZome('join_cloned_cell', { input, local });
  }

  /**
   *
   * @param entryHash
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getAppletClonedCell(
    entryHash: EntryHash,
    local: boolean = true,
  ): Promise<AppletClonedCell | undefined> {
    return this.callZome('get_applet_cloned_cell', { input: entryHash, local });
  }

  /**
   *
   * @param appletHash
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getAllClonedCellEntryHashesForApplet(
    appletHash: EntryHash,
    local: boolean = true,
  ): Promise<EntryHash[]> {
    return this.callZome('get_all_cloned_cell_entry_hashes_for_applet', {
      input: appletHash,
      local,
    });
  }

  /**
   *
   * @param appletHash
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getAllClonedCellsForApplet(
    appletHash: EntryHash,
    local: boolean = true,
  ): Promise<AppletClonedCell[]> {
    return this.callZome('get_all_cloned_cells_for_applet', { input: appletHash, local });
  }

  /**
   *
   * @param appletHash
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getUnjoinedClonedCellsForApplet(
    appletHash: EntryHash,
    local: boolean = true,
  ): Promise<EntryHash[]> {
    return this.callZome('get_unjoined_cloned_cells_for_applet', { input: appletHash, local });
  }

  /**
   * =============================================================================================
   * General stuff
   * =============================================================================================
   */

  /**
   * Send arbitrary data to peers via remote signal
   */
  async remoteSignalArbitrary(content: GroupRemoteSignal, toAgents: AgentPubKey[]): Promise<void> {
    return this.callZome('remote_signal_arbitrary', {
      to_agents: toAgents,
      content: encode(content),
    });
  }

  private callZome<T>(fn_name: string, payload: any) {
    const req: RoleNameCallZomeRequest = {
      role_name: this.roleName,
      zome_name: this.zomeName,
      fn_name,
      payload,
    };
    return this.appClient.callZome<T>(req);
  }
}

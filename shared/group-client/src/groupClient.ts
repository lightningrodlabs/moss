import { EntryRecord, isSignalFromCellWithRole } from '@holochain-open-dev/utils';
import {
  EntryHash,
  AppCallZomeRequest,
  Record,
  AppWebsocket,
  AgentPubKey,
  encodeHashToBase64,
  InstalledAppId,
  AppAuthenticationToken,
  ActionHash,
  SignalType,
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
  PermissionType,
  AppletEntryPrivate,
  StewardPermission,
  AppletClonedCell,
  GroupRemoteSignal,
  SignalPayloadGroup,
  GroupProfile,
} from './types.js';

export class GroupClient {
  constructor(
    public appClient: AppWebsocket,
    public authenticationToken: AppAuthenticationToken,
    public roleName: string,
    public zomeName: string = 'group',
  ) {}

  get myPubKey(): AgentPubKey {
    return this.appClient.myPubKey;
  }

  get installedAppId(): InstalledAppId {
    return this.appClient.installedAppId;
  }

  onSignal(listener: (eventData: SignalPayloadGroup) => void | Promise<void>): UnsubscribeFunction {
    return this.appClient.on('signal', async (signal) => {
      if (
        SignalType.App in signal &&
        (await isSignalFromCellWithRole(this.appClient, this.roleName, signal.App)) &&
        this.zomeName === signal.App.zome_name
      ) {
        listener(signal.App.payload as SignalPayloadGroup);
      }
    });
  }

  /** GroupProfile */

  async getGroupProfile(): Promise<EntryRecord<GroupProfile> | undefined> {
    const record = await this.callZome('get_group_profile', null);
    return record ? new EntryRecord(record) : undefined;
  }

  async setGroupProfile(groupProfile: GroupProfile): Promise<void> {
    await this.callZome('set_group_profile', groupProfile);
  }

  /** Applets */

  async getPublicApplet(appletHash: AppletHash): Promise<EntryRecord<Applet> | undefined> {
    const response: Record | undefined = await this.callZome('get_public_applet', appletHash);
    if (response) {
      return new EntryRecord(response);
    }
    return undefined;
  }

  async getGroupApplets(): Promise<Array<EntryHash>> {
    return this.callZome('get_group_applets', null);
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
   * @returns
   */
  async getUnjoinedApplets(): Promise<Array<[EntryHash, AgentPubKey, number]>> {
    return this.callZome('get_unjoined_applets', null);
  }

  /**
   * Gets Applet entries that have been advertised by other agents in the
   * group but have never been installed into the local conductor yet.
   * @returns
   */
  async getUnjoinedArchivedApplets(): Promise<Array<EntryHash>> {
    return this.callZome('get_unjoined_archived_applets', null);
  }

  async getArchivedApplets(): Promise<Array<EntryHash>> {
    return this.callZome('get_archived_applets', null);
  }

  async getApplet(appletHash: EntryHash): Promise<Applet | undefined> {
    const maybeApplet = await this.callZome('get_applet', appletHash);
    if (!maybeApplet) {
      console.warn(
        `@group-client: @getApplet: No applet found for hash: ${encodeHashToBase64(appletHash)}`,
      );
      return undefined;
    }
    return maybeApplet;
  }

  async getJoinedAppletAgents(appletHash: EntryHash): Promise<Array<AppletAgent>> {
    return this.callZome('get_joined_applet_agents', appletHash);
  }

  async getAbandonedAppletAgents(appletHash: EntryHash): Promise<Array<AppletAgent>> {
    return this.callZome('get_abandoned_applet_agents', appletHash);
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
   * @returns
   */
  async abandonApplet(appletHash: AppletHash): Promise<void> {
    return this.callZome('abandon_applet', appletHash);
  }

  async hashApplet(applet: Applet): Promise<EntryHash> {
    return this.callZome('hash_applet', applet);
  }

  async archiveApplet(appletHash: EntryHash): Promise<void> {
    return this.callZome('archive_applet', appletHash);
  }

  async unarchiveApplet(appletHash: EntryHash): Promise<void> {
    return this.callZome('unarchive_applet', appletHash);
  }

  async createStewardPermission(input: StewardPermission): Promise<EntryRecord<StewardPermission>> {
    const response: Record = await this.callZome('create_steward_permission', input);
    return new EntryRecord(response);
  }

  async getStewardPermission(
    permissionHash: AppletHash,
  ): Promise<EntryRecord<StewardPermission> | undefined> {
    const response: Record | undefined = await this.callZome(
      'get_steward_permission',
      permissionHash,
    );
    if (response) {
      return new EntryRecord(response);
    }
    return undefined;
  }

  async getMyPermissionType(): Promise<PermissionType> {
    return this.callZome('get_my_permission_type', null);
  }

  async getAgentPermissionType(agent: AgentPubKey): Promise<PermissionType> {
    return this.callZome('get_agent_permission_type', agent);
  }

  async getAllAgentPermissionTypes(): Promise<Array<[AgentPubKey, PermissionType]> | undefined> {
    return this.callZome('get_all_agent_permission_types', null);
  }

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

  async getGroupDescription(): Promise<EntryRecord<GroupMetaData> | undefined> {
    return this.getGroupMetaData(GROUP_DESCRIPTION_NAME);
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

  async getGroupAppletsMetaData(): Promise<GroupAppletsMetaData | undefined> {
    const metaDataRecord = await this.getGroupMetaData(GROUP_APPLETS_META_DATA_NAME);
    const maybeAppletsMetadata = metaDataRecord?.entry.data;
    if (!maybeAppletsMetadata) return undefined;
    return JSON.parse(maybeAppletsMetadata);
  }

  async getGroupMetaData(name: string): Promise<EntryRecord<GroupMetaData> | undefined> {
    const record = await this.callZome('get_group_meta_data', name);
    return record ? new EntryRecord(record) : undefined;
  }

  async setGroupMetaData(metaData: GroupMetaData): Promise<EntryRecord<GroupMetaData>> {
    const record = await this.callZome('set_group_meta_data', metaData);
    return new EntryRecord(record);
  }

  async joinClonedCell(input: AppletClonedCell): Promise<EntryHash> {
    return this.callZome('join_cloned_cell', input);
  }

  async getAppletClonedCell(input: AppletClonedCell): Promise<AppletClonedCell | undefined> {
    return this.callZome('get_applet_cloned_cell', input);
  }

  async getAllClonedCellEntryHashesForApplet(appletHash: EntryHash): Promise<EntryHash[]> {
    return this.callZome('get_all_cloned_cell_entry_hashes_for_applet', appletHash);
  }

  async getAllClonedCellsForApplet(appletHash: EntryHash): Promise<AppletClonedCell[]> {
    return this.callZome('get_all_cloned_cells_for_applet', appletHash);
  }

  async getUnjoinedClonedCellsForApplet(appletHash: EntryHash): Promise<EntryHash[]> {
    return this.callZome('get_unjoined_cloned_cells_for_applet', appletHash);
  }

  /**
   * Send arbitrary data to peers via remote signal
   */
  async remoteSignalArbitrary(content: GroupRemoteSignal, toAgents: AgentPubKey[]): Promise<void> {
    return this.callZome('remote_signal_arbitrary', {
      to_agents: toAgents,
      content: encode(content),
    });
  }

  private callZome(fn_name: string, payload: any) {
    const req: AppCallZomeRequest = {
      role_name: this.roleName,
      zome_name: this.zomeName,
      fn_name,
      payload,
    };
    return this.appClient.callZome(req);
  }
}

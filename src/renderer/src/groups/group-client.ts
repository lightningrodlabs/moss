import { EntryRecord } from '@holochain-open-dev/utils';
import {
  EntryHash,
  AppCallZomeRequest,
  Record,
  AppWebsocket,
  AgentPubKey,
  encodeHashToBase64,
  InstalledAppId,
  AppAuthenticationToken,
} from '@holochain/client';
import { AppletHash, GroupProfile } from '@lightningrodlabs/we-applet';

import {
  Applet,
  AppletAgent,
  JoinAppletInput,
  PermissionLevel,
  PrivateAppletEntry,
  StewardPermission,
} from '../types.js';

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
  async getMyJoinedApplets(): Promise<Array<PrivateAppletEntry>> {
    return this.callZome('get_my_joined_applets', null);
  }

  /**
   * Gets all the private Applet entries from the source chain
   * @returns
   */
  async getMyJoinedAppletsHashes(): Promise<Array<AppletHash>> {
    const applets: Array<PrivateAppletEntry> = await this.callZome('get_my_joined_applets', null);
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

  async getMyPermissionLevel(): Promise<PermissionLevel> {
    return this.callZome('get_my_permission_level', null);
  }

  async getAgentPermissionLevel(agent: AgentPubKey): Promise<PermissionLevel> {
    return this.callZome('get_agent_permission_level', agent);
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

import { EntryRecord, ZomeClient } from '@holochain-open-dev/utils';
import {
  ContributorPermission,
  Curator,
  DeveloperCollective,
  Tool,
  UpdateDeveloperCollectiveInput,
  UpdateToolInput,
  UpdateableEntity,
} from './types';
import {
  ActionHash,
  AgentPubKey,
  Link,
  decodeHashFromBase64,
  encodeHashToBase64,
} from '@holochain/client';

export class ToolsLibraryClient extends ZomeClient<undefined> {
  async getAllAgents(): Promise<AgentPubKey[]> {
    return this.callZome('get_all_agents', null);
  }

  async createDeveloperCollective(
    input: DeveloperCollective,
  ): Promise<EntryRecord<DeveloperCollective>> {
    const record = await this.callZome('create_developer_collective', input);
    return new EntryRecord(record);
  }

  async updateDeveloperCollective(
    input: UpdateDeveloperCollectiveInput,
  ): Promise<EntryRecord<DeveloperCollective>> {
    const record = await this.callZome('update_developer_collective', input);
    return new EntryRecord(record);
  }

  async createContributorPermission(
    input: ContributorPermission,
  ): Promise<EntryRecord<ContributorPermission>> {
    const record = await this.callZome('create_contributor_permission', input);
    return new EntryRecord(record);
  }

  /**
   *
   * @param developerCollectiveHash
   * @returns ActionHash of the permission, if any. Either the ActionHash of the developer collective
   * if it's an owner permission or the ActionHash of a ContributorPermission
   */
  async getMyPermission(developerCollectiveHash: ActionHash): Promise<ActionHash | undefined> {
    return this.callZome('get_my_permission', developerCollectiveHash);
  }

  async getAllContributorPermissions(
    developerCollectiveHash: ActionHash,
  ): Promise<EntryRecord<ContributorPermission>[]> {
    const records = await this.callZome('get_all_contributor_permissions', developerCollectiveHash);
    return records.map((record) => new EntryRecord(record));
  }

  async getAllDeveloperCollectiveLinks(): Promise<Array<Link>> {
    return this.callZome('get_all_developer_collective_links', null);
  }

  async getAllDeveloperCollectives(): Promise<EntryRecord<DeveloperCollective>[]> {
    const records = await this.callZome('get_all_original_developer_collectives', null);
    return records.map((record) => new EntryRecord(record));
  }

  /**
   * @returns original action hash and record of latest developer collective
   */
  async getMyDeveloperCollectives(): Promise<UpdateableEntity<DeveloperCollective>[]> {
    const developerCollectives: UpdateableEntity<DeveloperCollective>[] = [];
    const links: Array<Link> = await this.callZome('get_my_developer_collective_links', null);
    await Promise.all(
      links.map(async (link) => {
        const collective = await this.getDeveloperCollective(link.target);
        if (collective) developerCollectives.push(collective);
      }),
    );
    return developerCollectives;
  }

  async getMyContributorPermissions(): Promise<EntryRecord<ContributorPermission>[]> {
    const contributorPermissions: EntryRecord<ContributorPermission>[] = [];
    const links: Array<Link> = await this.callZome(
      'get_contributor_permissions_for_contributor',
      this.client.myPubKey,
    );
    await Promise.all(
      links.map(async (link) => {
        const permission = await this.getContributorPermission(link.target);
        if (permission) contributorPermissions.push(permission);
      }),
    );
    return contributorPermissions;
  }

  /**
   * Gets all developer collectives for which I have a ContributorPermission.
   * If I'm the creator of the DeveloperCOllective I cannot also have a
   * ContributorPermission (enforced by validation) since I already have full owner
   * permissions
   *
   * @returns
   */
  async getDeveloperCollectivesWithPermission(): Promise<UpdateableEntity<DeveloperCollective>[]> {
    const permissions = await this.getMyContributorPermissions();
    const collectiveHashesB64 = permissions.map((record) =>
      encodeHashToBase64(record.entry.for_collective),
    );
    // deduplicate hashes since multiple permissions may be granted for the same collective
    const uniqueCollectiveHashesB64 = [...new Set(collectiveHashesB64)];
    const collectives: UpdateableEntity<DeveloperCollective>[] = [];
    await Promise.all(
      uniqueCollectiveHashesB64.map(async (hashb64) => {
        const developerCollective = await this.getDeveloperCollective(
          decodeHashFromBase64(hashb64),
        );
        if (developerCollective) collectives.push(developerCollective);
      }),
    );
    return collectives;
  }

  async getContributorPermission(
    actionHash: ActionHash,
  ): Promise<EntryRecord<ContributorPermission> | undefined> {
    const record = await this.callZome('get_contributor_permission', actionHash);
    if (record) return new EntryRecord(record);
    return undefined;
  }

  async getDeveloperCollective(
    actionHash: ActionHash,
  ): Promise<UpdateableEntity<DeveloperCollective> | undefined> {
    const record = await this.callZome('get_latest_developer_collective', actionHash);
    if (record) return { originalActionHash: actionHash, record: new EntryRecord(record) };
    return undefined;
  }

  async createCurator(curator: Curator): Promise<EntryRecord<Curator>> {
    const record = await this.callZome('create_curator', curator);
    return new EntryRecord(record);
  }

  async createTool(tool: Tool): Promise<EntryRecord<Tool>> {
    const record = await this.callZome('create_tool', tool);
    return new EntryRecord(record);
  }

  async updateTool(input: UpdateToolInput): Promise<EntryRecord<Tool>> {
    const record = await this.callZome('update_tool', input);
    return new EntryRecord(record);
  }

  async getLatestTool(actionHash: ActionHash): Promise<UpdateableEntity<Tool> | undefined> {
    const record = await this.callZome('get_latest_tool', actionHash);
    if (record) return { originalActionHash: actionHash, record: new EntryRecord(record) };
    return undefined;
  }

  /**
   * @returns original action hash and record of latest developer collective
   */
  async getToolsForDeveloperCollective(
    developerCollectiveHash: ActionHash,
  ): Promise<UpdateableEntity<Tool>[]> {
    const tools: UpdateableEntity<Tool>[] = [];
    const links: Array<Link> = await this.callZome(
      'get_tool_links_for_developer_collective',
      developerCollectiveHash,
    );
    await Promise.all(
      links.map(async (link) => {
        const tool = await this.getLatestTool(link.target);
        if (tool) tools.push(tool);
      }),
    );
    return tools;
  }

  async getAllToolLinks(developerCollective: ActionHash): Promise<Link[]> {
    return this.callZome('get_tool_links_for_developer_collective', developerCollective);
  }

  /**
   * Gets all the latest Tool records
   * @returns
   */
  async getAllToolEntites(): Promise<UpdateableEntity<Tool>[]> {
    let allTools: UpdateableEntity<Tool>[] = [];
    const allDeveloperCollectiveLinks = await this.getAllDeveloperCollectiveLinks();
    await Promise.all(
      allDeveloperCollectiveLinks.map(async (link) => {
        const toolLinks = await this.getAllToolLinks(link.target);
        const maybeToolRecords = await Promise.all(
          toolLinks.map((link) => this.getLatestTool(link.target)),
        );
        const toolRecords = maybeToolRecords.filter(
          (maybeRecord) => !!maybeRecord,
        ) as UpdateableEntity<Tool>[];
        allTools = [...allTools, ...toolRecords];
      }),
    );
    return allTools;
  }
}

import { EntryRecord, ZomeClient } from '@holochain-open-dev/utils';
import {
  ContributorPermission,
  Curator,
  DeveloperCollective,
  Tool,
  UpdateDeveloperCollectiveInput,
} from './types';
import { ActionHash, Link } from '@holochain/client';

export class ToolsLibraryClient extends ZomeClient<undefined> {
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
    const records = await this.callZome('all_developer_collectives', null);
    return records.map((record) => new EntryRecord(record));
  }

  /**
   * @returns original action hash and record of latest developer collective
   */
  async getMyDeveloperCollectives(): Promise<[ActionHash, EntryRecord<DeveloperCollective>][]> {
    const developerCollectives: [ActionHash, EntryRecord<DeveloperCollective>][] = [];
    const links: Array<Link> = await this.callZome('get_my_developer_collective_links', null);
    await Promise.all(
      links.map(async (link) => {
        const collective = await this.getDeveloperCollective(link.target);
        if (collective) developerCollectives.push(collective);
      }),
    );
    return developerCollectives;
  }

  async getDeveloperCollective(
    actionHash: ActionHash,
  ): Promise<[ActionHash, EntryRecord<DeveloperCollective>] | undefined> {
    const record = await this.callZome('get_latest_developer_collective', actionHash);
    if (record) return [actionHash, new EntryRecord(record)];
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

  async getLatestTool(actionHash: ActionHash): Promise<EntryRecord<Tool> | undefined> {
    const record = await this.callZome('get_latest_tool', actionHash);
    if (record) return new EntryRecord(record);
    return undefined;
  }

  async getTool(actionHash: ActionHash): Promise<[ActionHash, EntryRecord<Tool>] | undefined> {
    const record = await this.callZome('get_latest_tool', actionHash);
    if (record) return [actionHash, new EntryRecord(record)];
    return undefined;
  }

  /**
   * @returns original action hash and record of latest developer collective
   */
  async getToolsForDeveloperCollective(
    developerCollectiveHash: ActionHash,
  ): Promise<[ActionHash, EntryRecord<Tool>][]> {
    const tools: [ActionHash, EntryRecord<Tool>][] = [];
    const links: Array<Link> = await this.callZome(
      'get_tool_links_for_developer_collective',
      developerCollectiveHash,
    );
    await Promise.all(
      links.map(async (link) => {
        const tool = await this.getTool(link.target);
        if (tool) tools.push(tool);
      }),
    );
    return tools;
  }

  async getAllToolLinks(developerCollective: ActionHash): Promise<Link[]> {
    return this.callZome('get_tool_links_for_developer_collective', developerCollective);
  }

  async getAllToolRecords(): Promise<EntryRecord<Tool>[]> {
    let allTools: EntryRecord<Tool>[] = [];
    const allDeveloperCollectiveLinks = await this.getAllDeveloperCollectiveLinks();
    await Promise.all(
      allDeveloperCollectiveLinks.map(async (link) => {
        const toolLinks = await this.getAllToolLinks(link.target);
        const maybeToolRecords = await Promise.all(
          toolLinks.map((link) => this.getLatestTool(link.target)),
        );
        const toolRecords = maybeToolRecords.filter(
          (maybeRecord) => !!maybeRecord,
        ) as EntryRecord<Tool>[];
        allTools = [...allTools, ...toolRecords];
      }),
    );
    return allTools;
  }
}

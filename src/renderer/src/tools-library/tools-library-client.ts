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

  async getAllDeveloperCollectives(): Promise<EntryRecord<DeveloperCollective>[]> {
    const records = await this.callZome('all_developer_collectives', null);
    return records.map((record) => new EntryRecord(record));
  }

  async getDeveloperCollective(
    actionHash: ActionHash,
  ): Promise<EntryRecord<DeveloperCollective> | undefined> {
    const record = await this.callZome('get_latest_developer_collective', actionHash);
    if (record) return new EntryRecord(record);
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

  async getTool(actionHash: ActionHash): Promise<EntryRecord<Tool> | undefined> {
    const record = await this.callZome('get_latest_tool', actionHash);
    if (record) return new EntryRecord(record);
    return undefined;
  }

  async getToolsForDeveloperCollective(
    developerCollectiveHash: ActionHash,
  ): Promise<EntryRecord<Tool>[]> {
    const records = await this.callZome(
      'get_tools_for_developer_collective',
      developerCollectiveHash,
    );
    return records.map((record) => new EntryRecord(record));
  }

  async getAllToolLinks(): Promise<Link[]> {
    return this.callZome('get_tool_links_for_developer_collective', null);
  }

  async getAllToolRecords(): Promise<EntryRecord<Tool>[]> {
    const links = await this.getAllToolLinks();
    const maybeToolRecords = await Promise.all(links.map((link) => this.getTool(link.target)));
    return maybeToolRecords.filter((maybeRecord) => !!maybeRecord) as EntryRecord<Tool>[];
  }
}

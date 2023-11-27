import { AppAgentClient, Record, ActionHash } from '@holochain/client';
import { EntryRecord, ZomeClient } from '@holochain-open-dev/utils';

import { CustomView, CustomViewsSignal } from './types.js';

export class CustomViewsClient extends ZomeClient<CustomViewsSignal> {
  constructor(
    public client: AppAgentClient,
    public roleName: string,
    public zomeName = 'custom_views',
  ) {
    super(client, roleName, zomeName);
  }
  /** Custom View */

  async createCustomView(customView: CustomView): Promise<EntryRecord<CustomView>> {
    const record: Record = await this.callZome('create_custom_view', customView);
    return new EntryRecord(record);
  }

  async getCustomView(customViewHash: ActionHash): Promise<EntryRecord<CustomView> | undefined> {
    const record: Record = await this.callZome('get_custom_view', customViewHash);
    return record ? new EntryRecord(record) : undefined;
  }

  deleteCustomView(originalCustomViewHash: ActionHash): Promise<ActionHash> {
    return this.callZome('delete_custom_view', originalCustomViewHash);
  }

  async updateCustomView(
    previousCustomViewHash: ActionHash,
    updatedCustomView: CustomView,
  ): Promise<EntryRecord<CustomView>> {
    const record: Record = await this.callZome('update_custom_view', {
      previous_custom_view_hash: previousCustomViewHash,
      updated_custom_view: updatedCustomView,
    });
    return new EntryRecord(record);
  }

  /** All Custom Views */

  async getAllCustomViews(): Promise<Array<EntryRecord<CustomView>>> {
    const records: Record[] = await this.callZome('get_all_custom_views', null);
    return records.map((r) => new EntryRecord(r));
  }
}

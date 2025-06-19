import { AppClient, Record, ActionHash } from '@holochain/client';
import { EntryRecord, ZomeClient } from '@holochain-open-dev/utils';

import { CustomView, CustomViewsSignal } from './types.js';

export class CustomViewsClient extends ZomeClient<CustomViewsSignal> {
  constructor(
    public client: AppClient,
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

  /**
   *
   * @param customViewHash
   * @param local Whether to use GetStrategy::Local or not
   * @returns
   */
  async getCustomView(
    customViewHash: ActionHash,
    local?: boolean,
  ): Promise<EntryRecord<CustomView> | undefined> {
    const record: Record = await this.callZome('get_custom_view', { input: customViewHash, local });
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

  async getAllCustomViews(local?: boolean): Promise<Array<EntryRecord<CustomView>>> {
    const records: Record[] = await this.callZome('get_all_custom_views', { input: null, local });
    return records.map((r) => new EntryRecord(r));
  }
}

import { lazyLoadAndPoll } from '@holochain-open-dev/stores';
import { ActionHash, LazyHoloHashMap } from '@holochain/client';

import { CustomViewsClient } from './custom-views-client.js';

export class CustomViewsStore {
  constructor(public client: CustomViewsClient) {}

  /** Custom View */

  customViews = new LazyHoloHashMap((customViewHash: ActionHash) =>
    lazyLoadAndPoll(
      async () => this.client.getCustomView(customViewHash),
      4000,
      async () => this.client.getCustomView(customViewHash, true),
    ),
  );

  /** All Custom Views */

  allCustomViews = lazyLoadAndPoll(
    async () => {
      const records = await this.client.getAllCustomViews();
      return records.map((r) => r.actionHash);
    },
    4000,
    async () => {
      const records = await this.client.getAllCustomViews(true);
      return records.map((r) => r.actionHash);
    },
  );
}

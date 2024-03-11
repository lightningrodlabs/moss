import { lazyLoadAndPoll } from '@holochain-open-dev/stores';
import { LazyMap } from '@holochain-open-dev/utils';

import { AttachmentsClient, Wal } from './attachments-client';

export class AttachmentsStore {
  constructor(public client: AttachmentsClient) {}

  outgoingLinks = new LazyMap((wal: Wal) =>
    lazyLoadAndPoll(() => this.client.getOutgoingLinks(wal), 2000),
  );

  incomingLinks = new LazyMap((wal: Wal) =>
    lazyLoadAndPoll(() => this.client.getIncomingLinks(wal), 2000),
  );
}

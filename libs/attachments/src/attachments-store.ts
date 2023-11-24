import { lazyLoadAndPoll } from "@holochain-open-dev/stores";
import { LazyHoloHashMap } from "@holochain-open-dev/utils";

import { AttachmentsClient } from "./attachments-client";

export class AttachmentsStore {
  constructor(public client: AttachmentsClient) {}

  attachments = new LazyHoloHashMap((hash) =>
    lazyLoadAndPoll(() => this.client.getAttachments(hash), 2000)
  );
}

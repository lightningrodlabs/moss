import { HoloHashMap, ZomeMock } from "@holochain-open-dev/utils";
import { AnyDhtHash } from "@holochain/client";
import { AgentPubKey, AppAgentClient } from "@holochain/client";
import { HrlWithContext } from "@lightningrodlabs/we-applet";

export class AttachmentsZomeMock extends ZomeMock implements AppAgentClient {
  attachments: HoloHashMap<AnyDhtHash, Array<HrlWithContext>> =
    new HoloHashMap();

  constructor(myPubKey?: AgentPubKey) {
    super("attachments", "attachments", myPubKey);
  }

  async add_attachment(input): Promise<void> {
    const attachments = this.attachments.get(input.hash) || [];
    this.attachments.set(input.hash, [...attachments, input.hrl_with_context]);
  }

  async get_attachments(hash: AnyDhtHash): Promise<Array<HrlWithContext>> {
    return this.attachments.get(hash);
  }
}

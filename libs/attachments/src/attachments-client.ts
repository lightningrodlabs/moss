import { AnyDhtHash, AppAgentClient, DnaHash } from "@holochain/client";
import { decode, encode } from "@msgpack/msgpack";
import { HrlWithContext } from "@lightningrodlabs/we-applet";
import { ZomeClient, getCellIdFromRoleName } from "@holochain-open-dev/utils";

export class AttachmentsClient extends ZomeClient<{}> {
  constructor(
    public client: AppAgentClient,
    public roleName: string,
    public zomeName = "attachments"
  ) {
    super(client, roleName, zomeName);
  }

  async getDnaHash(): Promise<DnaHash> {
    const appInfo = await this.client.appInfo();
    const cellId = getCellIdFromRoleName(this.roleName, appInfo);

    return cellId[0];
  }

  addAttachment(
    hash: AnyDhtHash,
    hrlWithContext: HrlWithContext
  ): Promise<void> {
    return this.callZome("add_attachment", {
      hash,
      hrl_with_context: {
        hrl: {
          dna_hash: hrlWithContext.hrl[0],
          resource_hash: hrlWithContext.hrl[1],
        },
        context: encode(hrlWithContext.context),
      },
    });
  }

  async getAttachments(hash: AnyDhtHash): Promise<Array<HrlWithContext>> {
    const hrls = await this.callZome("get_attachments", hash);

    return hrls.map((hrlWithContext) => ({
      hrl: [hrlWithContext.hrl.dna_hash, hrlWithContext.hrl.resource_hash],
      context: decode(hrlWithContext.context),
    }));
  }

  removeAttachment(
    hash: AnyDhtHash,
    hrlWithContext: HrlWithContext
  ): Promise<void> {
    return this.callZome("remove_attachment", {
      hash,
      hrl_with_context: {
        hrl: {
          dna_hash: hrlWithContext.hrl[0],
          resource_hash: hrlWithContext.hrl[1],
        },
        context: encode(hrlWithContext.context),
      },
    });
  }
}

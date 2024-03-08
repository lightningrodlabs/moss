import { AnyDhtHash, AppAgentClient, DnaHash } from '@holochain/client';
import { decode, encode } from '@msgpack/msgpack';
import { WAL } from '@lightningrodlabs/we-applet';
import { ZomeClient, getCellIdFromRoleName } from '@holochain-open-dev/utils';

export class AttachmentsClient extends ZomeClient<{}> {
  constructor(
    public client: AppAgentClient,
    public roleName: string,
    public zomeName = 'attachments',
  ) {
    super(client, roleName, zomeName);
  }

  async getDnaHash(): Promise<DnaHash> {
    const appInfo = await this.client.appInfo();
    const cellId = getCellIdFromRoleName(this.roleName, appInfo);

    return cellId[0];
  }

  addAttachment(hash: AnyDhtHash, wal: WAL): Promise<void> {
    return this.callZome('add_attachment', {
      hash,
      hrl_with_context: {
        hrl: {
          dna_hash: wal.hrl[0],
          resource_hash: wal.hrl[1],
        },
        context: encode(wal.context),
      },
    });
  }

  async getAttachments(hash: AnyDhtHash): Promise<Array<WAL>> {
    const hrls = await this.callZome('get_attachments', hash);

    return hrls.map((wal) => ({
      hrl: [wal.hrl.dna_hash, wal.hrl.resource_hash],
      context: decode(wal.context),
    }));
  }

  removeAttachment(hash: AnyDhtHash, wal: WAL): Promise<void> {
    return this.callZome('remove_attachment', {
      hash,
      hrl_with_context: {
        hrl: {
          dna_hash: wal.hrl[0],
          resource_hash: wal.hrl[1],
        },
        context: encode(wal.context),
      },
    });
  }
}

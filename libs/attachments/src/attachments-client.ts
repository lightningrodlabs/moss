import { ActionHash, AppClient, DnaHash } from '@holochain/client';
import { ZomeClient, getCellIdFromRoleName } from '@holochain-open-dev/utils';

type LinkingInput = {
  src_wal: string;
  dst_wal: string;
};

export type Wal = string;

export class AttachmentsClient extends ZomeClient<{}> {
  constructor(
    public client: AppClient,
    public roleName: string,
    public zomeName = 'attachments',
  ) {
    super(client, roleName, zomeName);
  }

  async getDnaHash(): Promise<DnaHash> {
    const appInfo = await this.client.appInfo();
    if (!appInfo) throw new Error('Appinfo is null.');
    const cellId = getCellIdFromRoleName(this.roleName, appInfo);

    return cellId[0];
  }

  async createOutgoingLink(input: LinkingInput): Promise<Array<ActionHash>> {
    return this.callZome('create_outgoing_link', input);
  }

  async createIncomingLink(input: LinkingInput): Promise<Array<ActionHash>> {
    return this.callZome('create_incoming_link', input);
  }

  async getOutgoingLinks(wal: Wal): Promise<Array<Wal>> {
    return this.callZome('get_outgoing_links', wal);
  }

  async getIncomingLinks(wal: Wal): Promise<Array<Wal>> {
    return this.callZome('get_incoming_links', wal);
  }

  async removeOutgoingLink(input: LinkingInput): Promise<Array<ActionHash>> {
    return this.callZome('remove_outgoing_link', input);
  }

  async removeIncomingLink(input: LinkingInput): Promise<Array<ActionHash>> {
    return this.callZome('remove_incoming_link', input);
  }
}

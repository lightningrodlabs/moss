import {
  asyncDerived,
  lazyLoad,
  lazyLoadAndPoll,
  pipe,
  retryUntilSuccess,
} from '@holochain-open-dev/stores';
import { EntryRecord, LazyHoloHashMap } from '@holochain-open-dev/utils';
import { ActionHash, AdminWebsocket, DnaHash, encodeHashToBase64 } from '@holochain/client';
import { ConductorInfo } from '../electron-api.js';
import { ToolsLibraryClient } from './tools-library-client.js';
import { Tool } from './types.js';

export class ToolsLibraryStore {
  constructor(
    public toolsLibraryClient: ToolsLibraryClient,
    public adminWebsocket: AdminWebsocket,
    public conductorInfo: ConductorInfo,
  ) {}

  private _toolsLibraryDnaHash: DnaHash | undefined;

  allInstallableTools = lazyLoadAndPoll(
    async () => this.toolsLibraryClient.getAllToolRecords(),
    30000,
  );

  installableTools = new LazyHoloHashMap((toolActionHash: ActionHash) =>
    asyncDerived(this.allInstallableTools, async (toolRecords) =>
      toolRecords.find(
        (toolRecord) => toolRecord.actionHash.toString() === toolActionHash.toString(),
      ),
    ),
  );

  toolLogo = new LazyHoloHashMap((toolActionHash: ActionHash) =>
    pipe(this.installableTools.get(toolActionHash), (toolEntryRecord) =>
      retryUntilSuccess(async () => {
        if (!toolEntryRecord)
          throw new Error(
            `Cannot find Tool Record for action hash: ${encodeHashToBase64(toolActionHash)}`,
          );

        return toolEntryRecord.entry.icon;
      }),
    ),
  );

  allDeveloperCollectives = new LazyHoloHashMap((actionHash: ActionHash) =>
    lazyLoad(async () => {
      const record = await this.toolsLibraryClient.getDeveloperCollective(actionHash);
      if (!record) throw new Error('Developer Collective not found for action hash.');
      return record;
    }),
  );

  async getLatestToolEntry(actionHash: ActionHash): Promise<EntryRecord<Tool>> {
    const toolRecord = await this.toolsLibraryClient.getTool(actionHash);
    if (!toolRecord) throw new Error('Tool not found for action hash.');
    return toolRecord;
  }

  async toolsLibraryDnaHash(): Promise<DnaHash> {
    if (this._toolsLibraryDnaHash) return this._toolsLibraryDnaHash;
    const toolsLibraryAppInfo = await this.toolsLibraryClient.client.appInfo();
    if (!toolsLibraryAppInfo) throw new Error('Tools Library AppInfo is null.');
    let toolsLibraryDnaHash: DnaHash | undefined = undefined;
    for (const [role_name, [cell]] of Object.entries(toolsLibraryAppInfo.cell_info)) {
      if (role_name === 'tools') {
        toolsLibraryDnaHash = cell['provisioned'].cell_id[0];
      }
    }
    if (!toolsLibraryDnaHash) throw new Error('Failed to get tool library DNA hash.');
    return toolsLibraryDnaHash;
  }
}

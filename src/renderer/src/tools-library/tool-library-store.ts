import {
  asyncDerived,
  lazyLoad,
  lazyLoadAndPoll,
  manualReloadStore,
  pipe,
  retryUntilSuccess,
} from '@holochain-open-dev/stores';
import { LazyHoloHashMap } from '@holochain-open-dev/utils';
import { ActionHash, AdminWebsocket, DnaHash, encodeHashToBase64 } from '@holochain/client';
import { ConductorInfo } from '../electron-api.js';
import { ToolsLibraryClient } from './tools-library-client.js';
import { Tool, UpdateableEntity } from './types.js';

export class ToolsLibraryStore {
  constructor(
    public toolsLibraryClient: ToolsLibraryClient,
    public adminWebsocket: AdminWebsocket,
    public conductorInfo: ConductorInfo,
  ) {}

  private _toolsLibraryDnaHash: DnaHash | undefined;

  allInstallableTools = lazyLoadAndPoll(
    async () => this.toolsLibraryClient.getAllToolEntites(),
    30000,
  );

  installableTools = new LazyHoloHashMap((orignalToolActionHash: ActionHash) =>
    asyncDerived(this.allInstallableTools, async (toolEntities) =>
      toolEntities.find(
        (toolEntity) =>
          toolEntity.originalActionHash.toString() === orignalToolActionHash.toString(),
      ),
    ),
  );

  toolLogo = new LazyHoloHashMap((orignalToolActionHash: ActionHash) =>
    pipe(this.installableTools.get(orignalToolActionHash), (toolEntity) =>
      retryUntilSuccess(async () => {
        if (!toolEntity)
          throw new Error(
            `Cannot find Tool Entity for action hash: ${encodeHashToBase64(orignalToolActionHash)}`,
          );

        return toolEntity.record.entry.icon;
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

  myDeveloperCollectives = manualReloadStore(async () =>
    this.toolsLibraryClient.getMyDeveloperCollectives(),
  );

  developerCollectivesWithPermission = manualReloadStore(async () =>
    this.toolsLibraryClient.getDeveloperCollectivesWithPermission(),
  );

  async getLatestToolEntry(actionHash: ActionHash): Promise<UpdateableEntity<Tool>> {
    const toolEntity = await this.toolsLibraryClient.getLatestTool(actionHash);
    if (!toolEntity) throw new Error('Tool not found for action hash.');
    return toolEntity;
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

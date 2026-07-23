import {
  asyncDerived,
  lazyLoad,
  lazyLoadAndPoll,
  manualReloadStore,
  pipe,
  retryUntilSuccess,
} from '@holochain-open-dev/stores';
import { ActionHash, LazyHoloHashMap, DnaHash, encodeHashToBase64, ProvisionedCell } from '@holochain/client';
import { ConductorInfo } from '../../electron-api.js';
import { Tool, UpdateableEntity, ToolsLibraryClient } from '@theweave/tool-library-client';

export class ToolsLibraryStore {
  constructor(
    public toolsLibraryClient: ToolsLibraryClient,
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
          encodeHashToBase64(toolEntity.originalActionHash) ===
          encodeHashToBase64(orignalToolActionHash),
      ),
    ),
  );

  toolLogo = new LazyHoloHashMap((originalToolActionHash: ActionHash) =>
    pipe(this.installableTools.get(originalToolActionHash)!, (toolEntity) =>
      retryUntilSuccess(async () => {
        if (!toolEntity)
          throw new Error(
            `Cannot find Tool Entity for action hash: ${encodeHashToBase64(originalToolActionHash)}`,
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
    for (const [role_name, cellInfos] of Object.entries(toolsLibraryAppInfo.cell_info)) {
      if (role_name === 'tools') {
        toolsLibraryDnaHash = (cellInfos[0].value as ProvisionedCell).cell_id[0];
      }
    }
    if (!toolsLibraryDnaHash) throw new Error('Failed to get tool library DNA hash.');
    return toolsLibraryDnaHash;
  }
}

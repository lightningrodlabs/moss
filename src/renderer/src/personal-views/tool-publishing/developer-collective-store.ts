import { manualReloadStore } from '@holochain-open-dev/stores';
import { ActionHash } from '@holochain/client';
import { ToolsLibraryClient } from '../tool-library/tools-library-client.js';

export class DeveloperCollectiveStore {
  developerCollectiveHash: ActionHash;

  constructor(
    public toolsLibraryClient: ToolsLibraryClient,
    developerCollectiveHash: ActionHash,
  ) {
    this.developerCollectiveHash = developerCollectiveHash;
  }

  allTools = manualReloadStore(async () =>
    this.toolsLibraryClient.getToolsForDeveloperCollective(this.developerCollectiveHash),
  );
}

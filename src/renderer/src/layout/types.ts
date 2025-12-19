import { DnaHash } from '@holochain/client';
import { WAL, OpenAssetMode, AppletHash, ToolCompatibilityId } from '@theweave/api';

export interface AppOpenViews {
  openAppletMain(appletHash: AppletHash, groupHash: DnaHash): void;
  openAppletBlock(appletHash: AppletHash, groupHash: DnaHash, block: string, context: any): void;
  openCrossGroupMain(toolCompatibilityId: ToolCompatibilityId): void;
  openCrossGroupBlock(toolCompatibilityId: ToolCompatibilityId, block: string, context: any): void;
  openAsset(wal: WAL, mode?: OpenAssetMode): void;
  userSelectWal(
    from?: 'search' | 'pocket' | 'create',
    groupDnaHash?: DnaHash | undefined,
  ): Promise<WAL | undefined>;
  userSelectAssetRelationTag(): Promise<string | undefined>;
  toggleClipboard(): void;
}

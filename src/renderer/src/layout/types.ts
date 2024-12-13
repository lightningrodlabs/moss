import { EntryHash } from '@holochain/client';
import { WAL, OpenAssetMode } from '@theweave/api';
import { ToolCompatibilityId } from '@theweave/moss-types';

export interface AppOpenViews {
  openAppletMain(appletHash: EntryHash): void;
  openAppletBlock(appletHash: EntryHash, block: string, context: any): void;
  openCrossAppletMain(toolCompatibilityId: ToolCompatibilityId): void;
  openCrossAppletBlock(toolCompatibilityId: ToolCompatibilityId, block: string, context: any): void;
  openAsset(wal: WAL, mode?: OpenAssetMode): void;
  userSelectWal(): Promise<WAL | undefined>;
  toggleClipboard(): void;
}

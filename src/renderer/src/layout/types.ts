import { ActionHash, EntryHash } from '@holochain/client';
import { WAL, OpenAssetMode } from '@theweave/api';

export interface AppOpenViews {
  openAppletMain(appletHash: EntryHash): void;
  openAppletBlock(appletHash: EntryHash, block: string, context: any): void;
  openCrossAppletMain(appletBundleHash: EntryHash): void;
  openCrossAppletBlock(appletBundleHash: ActionHash, block: string, context: any): void;
  openAsset(wal: WAL, mode?: OpenAssetMode): void;
  userSelectWal(): Promise<WAL | undefined>;
  toggleClipboard(): void;
}

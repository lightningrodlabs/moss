import { DnaHash, EntryHash } from '@holochain/client';
import { WAL, OpenAssetMode } from '@theweave/api';
import { ToolCompatibilityId } from '@theweave/moss-types';

export interface AppOpenViews {
  openAppletMain(appletHash: EntryHash, wal?: WAL): void;
  openCrossGroupMain(toolCompatibilityId: ToolCompatibilityId): void;
  openAsset(wal: WAL, mode?: OpenAssetMode): void;
  userSelectWal(
    from?: 'search' | 'pocket' | 'create' | 'pocket-no-create',
    groupDnaHash?: DnaHash | undefined,
  ): Promise<WAL | undefined>;
  userSelectAssetRelationTag(): Promise<string | undefined>;
  toggleClipboard(): void;
}

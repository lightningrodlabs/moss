import { EntryHash } from '@holochain/client';
import { WAL } from '@theweave/api';

export type AssetRelation = {
  src_wal: WAL;
  dst_wal: WAL;
};

export type AssetRelationAndHash = {
  src_wal: WAL;
  dst_wal: WAL;
  relation_hash: EntryHash;
};

export type AssetRelationWithTags = {
  src_wal: WAL;
  dst_wal: WAL;
  tags: string[];
  relation_hash: EntryHash;
};

export type RelateAssetsInput = {
  src_wal: WAL;
  dst_wal: WAL;
  tags: string[];
};

export type RemoveTagsFromAssetRelationInput = {
  relation_hash: EntryHash;
  tags: string[];
};

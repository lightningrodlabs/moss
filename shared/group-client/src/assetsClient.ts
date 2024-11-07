import { ZomeClient } from '@holochain-open-dev/utils';
import { EntryHash, AppClient, RoleName } from '@holochain/client';
import { WAL } from '@theweave/api';

import {
  AssetRelationAndHash,
  AssetRelationWithTags,
  RelateAssetsInput,
  SignalPayload,
  TagsToAssetInput,
} from './types.js';

export class AssetsClient extends ZomeClient<SignalPayload> {
  constructor(
    public client: AppClient,
    public roleName: RoleName,
    public zomeName = 'assets',
  ) {
    super(client, roleName, zomeName);
  }

  async addAssetRelation(
    srcWal: WAL,
    dstWal: WAL,
    tags?: string[],
  ): Promise<AssetRelationWithTags> {
    let input: RelateAssetsInput = {
      src_wal: srcWal,
      dst_wal: dstWal,
      tags: tags ? tags : [],
    };
    return this.callZome('add_asset_relation', input);
  }

  async removeAssetRelation(relationHash: EntryHash): Promise<AssetRelationWithTags> {
    return this.callZome('remove_asset_relation', relationHash);
  }

  async addTagsToAssetRelation(relationHash: EntryHash, tags: string[]): Promise<void> {
    return this.callZome('add_tags_to_asset_relation', {
      relation_hash: relationHash,
      tags,
    });
  }

  async removeTagsFromAssetRelation(relationHash: EntryHash, tags: string[]): Promise<void> {
    return this.callZome('add_tags_to_asset_relation', {
      relation_hash: relationHash,
      tags,
    });
  }

  async getOutgoingAssetRelations(srcWal: WAL): Promise<AssetRelationAndHash[]> {
    return this.callZome('get_outgoing_asset_relations', srcWal);
  }

  async getOutgoingAssetRelationsWithTags(srcWal: WAL): Promise<AssetRelationWithTags[]> {
    return this.callZome('get_outgoing_asset_relations_with_tags', srcWal);
  }

  async getIncomingAssetRelations(srcWal: WAL): Promise<AssetRelationAndHash[]> {
    return this.callZome('get_outgoing_asset_relations', srcWal);
  }

  async getIncomingAssetRelationsWithTags(srcWal: WAL): Promise<AssetRelationWithTags[]> {
    return this.callZome('get_incoming_asset_relations_with_tags', srcWal);
  }

  async addTagsToAsset(wal: WAL, tags: string[]): Promise<void> {
    const input: TagsToAssetInput = {
      wal,
      tags,
    };
    return this.callZome('add_tags_to_asset', input);
  }

  async removeTagsFromAsset(wal: WAL, tags: string[]): Promise<void> {
    return this.callZome('add_tags_to_asset', {
      wal,
      tags,
    });
  }
}

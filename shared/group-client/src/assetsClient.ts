import { ZomeClient } from '@holochain-open-dev/utils';
import { EntryHash, AppClient } from '@holochain/client';
import { WAL, WalRelationAndTags } from '@theweave/api';

import {
  AssetRelationAndHash,
  AssetRelationWithTags,
  RelateAssetsInput,
  RelationsForWal,
  SignalPayloadAssets,
  TagsToAssetInput,
} from './types.js';
import { AsyncStatus, Unsubscriber, writable, Writable } from '@holochain-open-dev/stores';
import { decode, encode } from '@msgpack/msgpack';

export type WalStoreContent = {
  linkedTo: WalRelationAndTags[];
  linkedFrom: WalRelationAndTags[];
  tags: string[];
};

export class WalStore {
  private client: AssetsClient;
  public wal: WAL;

  private subscribers: number[] = [];

  walStore: Writable<AsyncStatus<WalStoreContent>> = writable({
    status: 'pending',
  });

  constructor(client: AssetsClient, wal: WAL) {
    this.client = client;
    this.wal = wal;
  }

  subscribe(cb: (value: AsyncStatus<WalStoreContent>) => any): Unsubscriber {
    const firstSubscriber = !this.isSubscribed;

    const subscriberId = this.addSubscriber();

    const unsubscribe = this.walStore.subscribe((val) => cb(val));

    if (firstSubscriber) {
      setTimeout(this.pollStore);
    }

    return () => {
      this.removeSubscriber(subscriberId);
      unsubscribe();
    };
  }

  get isSubscribed() {
    return this.subscribers.length > 0;
  }

  addSubscriber(): number {
    let id = Math.max(...this.subscribers) + 1;
    this.subscribers = [...this.subscribers, id];
    return id;
  }

  removeSubscriber(id: number) {
    this.subscribers = this.subscribers.filter((s) => s != id);
  }

  pollStore = async () => {
    console.log('Polling in WalStore. Current subscriber count: ', this.subscribers.length);
    const relationsForWal = await this.client.getAllRelationsForWal(this.wal);
    const linkedTo = relationsForWal.linked_to.map((v) => ({
      wal: v.dst_wal,
      tags: v.tags,
      relationHash: v.relation_hash,
      createdAt: v.created_at,
    }));
    const linkedFrom = relationsForWal.linked_from.map((v) => ({
      wal: v.dst_wal,
      tags: v.tags,
      relationHash: v.relation_hash,
      createdAt: v.created_at,
    }));
    this.walStore.set({
      status: 'complete',
      value: { tags: relationsForWal.tags, linkedFrom, linkedTo },
    });
  };
}

export class AssetsClient extends ZomeClient<SignalPayloadAssets> {
  constructor(
    public client: AppClient,
    public roleName = 'assets',
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
      src_wal: walEncodeContext(srcWal),
      dst_wal: walEncodeContext(dstWal),
      tags: tags ? tags : [],
    };
    const assetRelationWithTags = await this.callZome('add_asset_relation', input);
    return decodeAssetRelationWALs(assetRelationWithTags);
  }

  async removeAssetRelation(relationHash: EntryHash): Promise<void> {
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
    const assetRelations = await this.callZome(
      'get_outgoing_asset_relations',
      walEncodeContext(srcWal),
    );
    return decodeAssetRelationsWALs(assetRelations);
  }

  async getOutgoingAssetRelationsWithTags(srcWal: WAL): Promise<AssetRelationWithTags[]> {
    const assetRelations = await this.callZome(
      'get_outgoing_asset_relations_with_tags',
      walEncodeContext(srcWal),
    );
    return decodeAssetRelationsWALs(assetRelations);
  }

  async getIncomingAssetRelations(srcWal: WAL): Promise<AssetRelationAndHash[]> {
    const assetRelations = await this.callZome(
      'get_incoming_asset_relations',
      walEncodeContext(srcWal),
    );
    return decodeAssetRelationsWALs(assetRelations);
  }

  async getIncomingAssetRelationsWithTags(srcWal: WAL): Promise<AssetRelationWithTags[]> {
    const assetRelations = await this.callZome(
      'get_incoming_asset_relations_with_tags',
      walEncodeContext(srcWal),
    );
    return decodeAssetRelationsWALs(assetRelations);
  }

  async addTagsToAsset(wal: WAL, tags: string[]): Promise<void> {
    const input: TagsToAssetInput = {
      wal: walEncodeContext(wal),
      tags,
    };
    return this.callZome('add_tags_to_asset', input);
  }

  async removeTagsFromAsset(wal: WAL, tags: string[]): Promise<void> {
    return this.callZome('remove_tags_from_asset', {
      wal: walEncodeContext(wal),
      tags,
    });
  }

  async getTagsForAsset(wal: WAL): Promise<string[]> {
    return this.callZome('get_tags_for_asset', walEncodeContext(wal));
  }

  async getAllRelationsForWal(wal: WAL): Promise<RelationsForWal> {
    return this.callZome('get_all_relations_for_wal', walEncodeContext(wal));
  }

  async batchGetAllRelationsForWal(wals: WAL[]): Promise<RelationsForWal[]> {
    return this.callZome('batch_get_all_relations_for_wal', walsEncodeContext(wals));
  }
}

/**
 * Converts a WAL to a WAL with the same context but msgpack encoded
 *
 * @param wal
 * @returns
 */
function walEncodeContext(wal: WAL): WAL {
  return {
    hrl: wal.hrl,
    context: wal.context ? encode(wal.context) : undefined,
  };
}

/**
 * Converts a WAL to a WAL with the same context but msgpack decoded
 *
 * @param wal
 * @returns
 */
export function walDecodeContext(wal: WAL): WAL {
  return {
    hrl: wal.hrl,
    context: wal.context ? decode(wal.context) : undefined,
  };
}

export function walsEncodeContext(wals: WAL[]): WAL[] {
  return wals.map((wal) => walEncodeContext(wal));
}

export function decodeAssetRelationsWALs(
  relationsWithTags: AssetRelationWithTags[],
): AssetRelationWithTags[] {
  return relationsWithTags.map((relationWithTags) => decodeAssetRelationWALs(relationWithTags));
}

export function decodeAssetRelationWALs(
  relationWithTags: AssetRelationWithTags,
): AssetRelationWithTags {
  return {
    src_wal: walDecodeContext(relationWithTags.src_wal),
    dst_wal: walDecodeContext(relationWithTags.dst_wal),
    tags: relationWithTags.tags,
    relation_hash: relationWithTags.relation_hash,
    created_at: relationWithTags.created_at,
  };
}

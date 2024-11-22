import { ZomeClient } from '@holochain-open-dev/utils';
import { EntryHash, AppClient, RoleName } from '@holochain/client';
import { WAL, WalAndTags } from '@theweave/api';

import {
  AssetRelationAndHash,
  AssetRelationWithTags,
  RelateAssetsInput,
  RelationsForWal,
  SignalPayloadAssets,
  TagsToAssetInput,
} from './types.js';
import { AsyncStatus, Unsubscriber, writable, Writable } from '@holochain-open-dev/stores';

export type WalStoreContent = {
  linkedTo: WalAndTags[];
  linkedFrom: WalAndTags[];
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
    }));
    const linkedFrom = relationsForWal.linked_from.map((v) => ({
      wal: v.dst_wal,
      tags: v.tags,
      relationHash: v.relation_hash,
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
    return this.callZome('remove_tags_from_asset', {
      wal,
      tags,
    });
  }

  async getTagsForAsset(wal: WAL): Promise<string[]> {
    return this.callZome('get_tags_for_asset', wal);
  }

  async getAllRelationsForWal(wal: WAL): Promise<RelationsForWal> {
    return this.callZome('get_all_relations_for_wal', wal);
  }

  async batchGetAllRelationsForWal(wals: WAL[]): Promise<RelationsForWal[]> {
    return this.callZome('batch_get_all_relations_for_wal', wals);
  }
}

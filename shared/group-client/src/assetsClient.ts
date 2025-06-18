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

  /**
   *
   * @param srcWal
   * @param dstWal
   * @param tags
   * @param local Whether to use `GetStrategy::Local` or not. The `GetStrategy` is being used
   * to check whether the AssetRelation does already exist and may not need to be created
   * @returns
   */
  async addAssetRelation(
    srcWal: WAL,
    dstWal: WAL,
    tags?: string[],
    local?: boolean,
  ): Promise<AssetRelationWithTags> {
    let input: RelateAssetsInput = {
      src_wal: walEncodeContext(srcWal),
      dst_wal: walEncodeContext(dstWal),
      tags: tags ? tags : [],
    };
    const assetRelationWithTags = await this.callZome('add_asset_relation', { input, local });
    return decodeAssetRelationWALs(assetRelationWithTags) as AssetRelationWithTags;
  }

  /**
   *
   * @param relationHash
   * @param local Whether to use `GetStrategy::Local` or not. The `GetStrategy` is being used
   * amongst others to get all the links to be deleted.
   * @returns
   */
  async removeAssetRelation(relationHash: EntryHash, local?: boolean): Promise<void> {
    return this.callZome('remove_asset_relation', { input: relationHash, local });
  }

  /**
   *
   * @param relationHash
   * @param tags
   * @param local Whether to use `GetStrategy::Local` or not (the GetStrategy is being used
   * when checking whether the asset to which tags are to be added actually exists)
   * @returns
   */
  async addTagsToAssetRelation(
    relationHash: EntryHash,
    tags: string[],
    local?: boolean,
  ): Promise<void> {
    return this.callZome('add_tags_to_asset_relation', {
      input: {
        relation_hash: relationHash,
        tags,
      },
      local,
    });
  }

  /**
   *
   * @param relationHash
   * @param tags
   * @param local Whether to use `GetStrategy::Local` or not
   * @returns
   */
  async removeTagsFromAssetRelation(
    relationHash: EntryHash,
    tags: string[],
    local?: boolean,
  ): Promise<void> {
    return this.callZome('remove_tags_from_asset_relation', {
      input: {
        relation_hash: relationHash,
        tags,
      },
      local,
    });
  }

  /**
   *
   * @param srcWal
   * @param local Whether to use `GetStrategy::Local` or not
   * @returns
   */
  async getOutgoingAssetRelations(srcWal: WAL, local: boolean): Promise<AssetRelationAndHash[]> {
    const assetRelations = await this.callZome('get_outgoing_asset_relations', {
      input: walEncodeContext(srcWal),
      local,
    });
    return decodeAssetRelationsWALs(assetRelations);
  }

  /**
   *
   * @param srcWal
   * @param local Whether to use `GetStrategy::Local` or not
   * @returns
   */
  async getOutgoingAssetRelationsWithTags(
    srcWal: WAL,
    local?: boolean,
  ): Promise<AssetRelationWithTags[]> {
    const assetRelations = await this.callZome('get_outgoing_asset_relations_with_tags', {
      input: walEncodeContext(srcWal),
      local,
    });
    return decodeAssetRelationsWALs(assetRelations) as AssetRelationWithTags[];
  }

  /**
   *
   * @param srcWal
   * @param local Whether to use `GetStrategy::Local` or not
   * @returns
   */
  async getIncomingAssetRelations(srcWal: WAL, local?: boolean): Promise<AssetRelationAndHash[]> {
    const assetRelations = await this.callZome('get_incoming_asset_relations', {
      input: walEncodeContext(srcWal),
      local,
    });
    return decodeAssetRelationsWALs(assetRelations);
  }

  /**
   *
   * @param srcWal
   * @param local Whether to use `GetStrategy::Local` or not
   * @returns
   */
  async getIncomingAssetRelationsWithTags(
    srcWal: WAL,
    local?: boolean,
  ): Promise<AssetRelationWithTags[]> {
    const assetRelations = await this.callZome('get_incoming_asset_relations_with_tags', {
      input: walEncodeContext(srcWal),
      local,
    });
    return decodeAssetRelationsWALs(assetRelations) as AssetRelationWithTags[];
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

  /**
   *
   * @param wal
   * @param local Whether to use `GetStrategy::Local` or not
   * @returns
   */
  async getTagsForAsset(wal: WAL, local?: boolean): Promise<string[]> {
    return this.callZome('get_tags_for_asset', { input: walEncodeContext(wal), local });
  }

  /**
   *
   * @param wal
   * @param local Whether to use `GetStrategy::Local` or not
   * @returns
   */
  async getAllRelationsForWal(wal: WAL, local?: boolean): Promise<RelationsForWal> {
    const relationsForWal: RelationsForWal = await this.callZome('get_all_relations_for_wal', {
      input: walEncodeContext(wal),
      local,
    });

    return {
      wal: relationsForWal.wal,
      tags: relationsForWal.tags,
      linked_from: decodeAssetRelationsWALs(relationsForWal.linked_from) as AssetRelationWithTags[],
      linked_to: decodeAssetRelationsWALs(relationsForWal.linked_to) as AssetRelationWithTags[],
    };
  }

  /**
   *
   * @param wals
   * @param local Whether to use `GetStrategy::Local` or not
   * @returns
   */
  async batchGetAllRelationsForWal(wals: WAL[], local?: boolean): Promise<RelationsForWal[]> {
    const relationsForWals: RelationsForWal[] = await this.callZome(
      'batch_get_all_relations_for_wal',
      { input: walsEncodeContext(wals), local },
    );
    return relationsForWals.map((relationsForWal) => ({
      wal: relationsForWal.wal,
      tags: relationsForWal.tags,
      linked_from: decodeAssetRelationsWALs(relationsForWal.linked_from) as AssetRelationWithTags[],
      linked_to: decodeAssetRelationsWALs(relationsForWal.linked_to) as AssetRelationWithTags[],
    }));
  }

  /**
   *
   * @param local Whether to use `GetStrategy::Local` or not
   * @returns
   */
  async getAllAssetRelations(local?: boolean): Promise<AssetRelationAndHash[]> {
    const assetRelationsAndHash = await this.callZome('get_all_asset_relations', {
      input: null,
      local,
    });
    return decodeAssetRelationsWALs(assetRelationsAndHash);
  }

  /**
   *
   * @param local Whether to use `GetStrategy::Local` or not
   * @returns
   */
  async getAllAssetRelationsWithTags(local?: boolean): Promise<AssetRelationWithTags[]> {
    const assetRelationsWithTags = await this.callZome('get_all_asset_relations_with_tags', {
      input: null,
      local,
    });
    return decodeAssetRelationsWALs(assetRelationsWithTags) as AssetRelationWithTags[];
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
): AssetRelationWithTags[] | AssetRelationAndHash[] {
  return relationsWithTags.map((relationWithTags) => decodeAssetRelationWALs(relationWithTags));
}

export function decodeAssetRelationWALs(
  relationWithTags: AssetRelationWithTags | AssetRelationAndHash,
): AssetRelationWithTags | AssetRelationAndHash {
  return 'tags' in relationWithTags
    ? {
        src_wal: walDecodeContext(relationWithTags.src_wal),
        dst_wal: walDecodeContext(relationWithTags.dst_wal),
        tags: relationWithTags.tags,
        relation_hash: relationWithTags.relation_hash,
        created_at: relationWithTags.created_at,
      }
    : {
        src_wal: walDecodeContext(relationWithTags.src_wal),
        dst_wal: walDecodeContext(relationWithTags.dst_wal),
        relation_hash: relationWithTags.relation_hash,
        created_at: relationWithTags.created_at,
      };
}

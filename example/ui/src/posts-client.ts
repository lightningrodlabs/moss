import { Post } from './types';

import { AppAgentClient, Record, ActionHash, DnaHash } from '@holochain/client';
import { EntryRecord, ZomeClient, getCellIdFromRoleName } from '@holochain-open-dev/utils';

import { PostsSignal } from './types.js';

export class PostsClient extends ZomeClient<PostsSignal> {
  constructor(public client: AppAgentClient, public roleName: string, public zomeName = 'posts') {
    super(client, roleName, zomeName);
  }

  async getDnaHash(): Promise<DnaHash> {
    const appInfo = await this.client.appInfo();
    if (!appInfo) throw new Error('AppInfo is null.');
    const cellId = getCellIdFromRoleName(this.roleName, appInfo);

    return cellId[0];
  }

  /** Post */

  async createPost(post: Post): Promise<EntryRecord<Post>> {
    const record: Record = await this.callZome('create_post', post);
    return new EntryRecord(record);
  }

  async getPost(postHash: ActionHash): Promise<EntryRecord<Post> | undefined> {
    const record: Record = await this.callZome('get_post', postHash);
    return record ? new EntryRecord(record) : undefined;
  }

  deletePost(originalPostHash: ActionHash): Promise<ActionHash> {
    return this.callZome('delete_post', originalPostHash);
  }

  async updatePost(
    originalPostHash: ActionHash,
    previousPostHash: ActionHash,
    updatedPost: Post
  ): Promise<EntryRecord<Post>> {
    const record: Record = await this.callZome('update_post', {
      original_post_hash: originalPostHash,
      previous_post_hash: previousPostHash,
      updated_post: updatedPost,
    });
    return new EntryRecord(record);
  }

  /** All Posts */

  async getAllPosts(): Promise<Array<EntryRecord<Post>>> {
    const records: Record[] = await this.callZome('get_all_posts', null);
    return records.map((r) => new EntryRecord(r));
  }
}

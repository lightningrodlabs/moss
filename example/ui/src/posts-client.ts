import { Post } from './types';

import { 
  AppAgentClient, 
  Record, 
  ActionHash, 
  EntryHash, 
  AgentPubKey,
} from '@holochain/client';
import { isSignalFromCellWithRole, EntryRecord, ZomeClient } from '@holochain-open-dev/utils';

import { PostsSignal } from './types.js';

export class PostsClient extends ZomeClient<PostsSignal> {
  constructor(public client: AppAgentClient, public roleName: string, public zomeName = 'posts') {
    super(client, roleName, zomeName);
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

  async updatePost(originalPostHash: ActionHash, previousPostHash: ActionHash, updatedPost: Post): Promise<EntryRecord<Post>> {
    const record: Record = await this.callZome('update_post', {
      original_post_hash: originalPostHash,
      previous_post_hash: previousPostHash,
      updated_post: updatedPost
    });
    return new EntryRecord(record);
  }

  /** All Posts */

  async getAllPosts(): Promise<Array<EntryRecord<Post>>> {
    const records: Record[] = await this.callZome('get_all_posts', null);
    return records.map(r => new EntryRecord(r));
  }

}

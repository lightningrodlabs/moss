import { Post } from './types';

import { lazyLoadAndPoll, AsyncReadable } from "@holochain-open-dev/stores";
import { EntryRecord, LazyHoloHashMap } from "@holochain-open-dev/utils";
import { NewEntryAction, Record, ActionHash, EntryHash, AgentPubKey } from '@holochain/client';

import { PostsClient } from './posts-client.js';

export class PostsStore {
  constructor(public client: PostsClient) {}

  /** Post */

  posts = new LazyHoloHashMap((postHash: ActionHash) =>
    lazyLoadAndPoll(async () => this.client.getPost(postHash), 4000)
  );

  /** All Posts */

  allPosts = lazyLoadAndPoll(async () => {
    const records = await this.client.getAllPosts();
    return records;
  }, 15000);
}

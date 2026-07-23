import { SignedActionHashed } from '@holochain/client';

export type PostsSignal =
  | {
      type: 'EntryCreated';
      action: SignedActionHashed;
      app_entry: EntryTypes;
    }
  | {
      type: 'EntryUpdated';
      action: SignedActionHashed;
      app_entry: EntryTypes;
      original_app_entry: EntryTypes;
    }
  | {
      type: 'EntryDeleted';
      action: SignedActionHashed;
      original_app_entry: EntryTypes;
    }
  | {
      type: 'LinkCreated';
      action: SignedActionHashed;
      link_type: string;
    }
  | {
      type: 'LinkDeleted';
      action: SignedActionHashed;
      link_type: string;
    };

export type EntryTypes = { type: 'Post' } & Post;

export interface Post {
  title: string;
  content: string;
}

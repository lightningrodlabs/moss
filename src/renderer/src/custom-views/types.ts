import {
  SignedActionHashed,
  Create,
  Update,
  Delete,
  CreateLink,
  DeleteLink,
} from '@holochain/client';

export type CustomViewsSignal =
  | {
      type: 'EntryCreated';
      action: SignedActionHashed<Create>;
      app_entry: EntryTypes;
    }
  | {
      type: 'EntryUpdated';
      action: SignedActionHashed<Update>;
      app_entry: EntryTypes;
      original_app_entry: EntryTypes;
    }
  | {
      type: 'EntryDeleted';
      action: SignedActionHashed<Delete>;
      original_app_entry: EntryTypes;
    }
  | {
      type: 'LinkCreated';
      action: SignedActionHashed<CreateLink>;
      link_type: string;
    }
  | {
      type: 'LinkDeleted';
      action: SignedActionHashed<DeleteLink>;
      link_type: string;
    };

export type EntryTypes = { type: 'CustomView' } & CustomView;

export interface CustomView {
  name: string;

  logo: string;

  html: string;

  js: string;

  css: string;
}

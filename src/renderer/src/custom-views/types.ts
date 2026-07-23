import { SignedActionHashed } from '@holochain/client';

export type CustomViewsSignal =
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

export type EntryTypes = { type: 'CustomView' } & CustomView;

export interface CustomView {
  name: string;

  logo: string;

  html: string;

  js: string;

  css: string;
}

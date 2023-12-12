import { ActionHashB64, DnaHash, DnaHashB64, EntryHash, EntryHashB64 } from '@holochain/client';

/**
 * EntryHashB64 of the Applet entry in the group's We DHT.
 */
export type AppletId = string;

/**
 * EntryHash of the Applet entry in the group's We DHT.
 */
export type AppletHash = EntryHash;

/**
 * DnaHash of a We group
 */
export type GroupDnaHash = DnaHash;

export type AppHashes =
  | {
      type: 'webhapp';
      sha256: string;
      happ: {
        sha256: string;
      };
      ui: {
        sha256: string;
      };
    }
  | {
      type: 'happ';
      sha256: string;
    };

export type DistributionInfo =
  | {
      type: 'appstore-light';
      info: {
        appstoreDnaHash: DnaHashB64;
        // according to https://docs.rs/hc_crud_caps/0.10.3/hc_crud/struct.Entity.html
        appEntryId: ActionHashB64;
        appEntryActionHash: ActionHashB64;
        appEntryEntryHash: EntryHashB64;
      };
    }
  | {
      type: 'filesystem'; // Installed from filesystem
    };

import { DnaHash, EntryHash } from '@holochain/client';

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

import { DnaHash } from '@holochain/client';
import { AppletHash } from '@theweave/api';

export type AppletSelectedEvent = {
  groupHash: DnaHash,
  appletHash: AppletHash,
};

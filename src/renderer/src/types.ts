import { AgentPubKeyB64, DnaHash, FullStateDump } from '@holochain/client';
import { AppletId, FrameNotification } from '@theweave/api';

/**
 * DnaHash of a We group
 */
export type GroupDnaHash = DnaHash;

export type AppletNotification = {
  appletId: AppletId;
  notification: FrameNotification;
};

export type MessageContentPart =
  | {
      type: 'text';
      content: string;
    }
  | {
      type: 'agent';
      pubkey: AgentPubKeyB64;
    };

/**
 * Notification feed to end-users
 */
export type UpdateFeed = {
  [key: string]: Array<UpdateFeedMessage>;
};

export type UpdateFeedMessage = {
  type: string;
  timestamp: number;
  message: string;
};

export type DumpData = {
  dump: FullStateDump;
  newOpsCount: number;
};

export type ToolWeaveConfig = {
  crossGroupView: boolean;
};

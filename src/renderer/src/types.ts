import { AgentPubKeyB64, DnaHash } from '@holochain/client';
import { AppletId, FrameNotification, WAL } from '@theweave/api';
import {
  CuratedTool,
  DistributionInfo,
  ToolCompatibilityId,
  ToolCurator,
  ToolInfoAndVersions,
  ToolVersionInfo,
} from '@theweave/moss-types';

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

export type ToolWeaveConfig = {
  crossGroupView: boolean;
};

export type ToolListUrl = string;

export type ToolAndCurationInfo = {
  toolCompatibilityId: ToolCompatibilityId;
  toolInfoAndVersions: ToolInfoAndVersions;
  curationInfos: Array<{
    info: CuratedTool;
    curator: ToolCurator;
  }>;
  latestVersion: ToolVersionInfo;
  toolListUrl: string;
  developerCollectiveId: string;
};

export type ToolInfoAndLatestVersion = {
  toolInfo: ToolInfoAndVersions;
  latestVersion: ToolVersionInfo;
  distributionInfo: DistributionInfo;
};

export type MossEvent = 'open-asset';

export type MossEventMap = {
  'open-asset': WAL;
};

export type CallbackWithId = {
  id: number;
  callback: (e: MossEventMap[MossEvent]) => any;
};

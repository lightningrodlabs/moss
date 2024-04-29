import { ActionHash } from '@holochain/client';

export const TOOLS_LIBRARY_APP_ID = 'ToolsLibrary';

// ATTENTION: If this type is changed, the same type in src/renderer/types needs to be changed as well.
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

export type Tool = {
  developer_collective: ActionHash;
  permission_hash: ActionHash; // Either the CreateAction hash of the DeveloperCollective entry or an ActionHash of a ContributorPermission entry
  title: string;
  subtitle: string;
  description: string;
  icon: string; // base64 string
  version: string;
  source: string; // JSON string containing information about where to get this Tool from
  hashes: string; // Hashes related to this Tool to verify its integrity
  changelog: string | undefined;
  meta_data: string | undefined;
  deprecation: string | undefined;
};

export type DeveloperCollective = {
  name: string;
  description: string;
  website: string;
  contact: string;
  icon: string;
  meta_data: string | undefined;
};

import { ActionHash } from '@holochain/client';

export const TOOLS_LIBRARY_APP_ID = 'default-app#tool-library';

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

// CHANGE ALSO IN src/renderer/src/electron-api.ts
export interface ConductorInfo {
  app_port: number;
  admin_port: number;
  tools_library_app_id: string;
  moss_version: string;
  weave_protocol_version: string;
}

export type ToolWeaveConfig = {
  crossGroupView: boolean;
};

export type ToolUserPreferences = {
  cameraAccessGranted?: boolean;
  microphoneAccessGranted?: boolean;
  fullMediaAccessGranted?: boolean;
};

import { ActionHash } from '@holochain/client';

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
export interface NetworkInfo {
  bootstrap_urls: string[];
  relay_urls: string[];
}
// CHANGE ALSO IN src/renderer/src/electron-api.ts
export interface ConductorInfo {
  app_port: number;
  admin_port: number;
  moss_version: string;
  weave_protocol_version: string;
  network_info: NetworkInfo;
}

export type ToolWeaveConfig = {
  crossGroupView: boolean;
};

export type ToolUserPreferences = {
  cameraAccessGranted?: boolean;
  microphoneAccessGranted?: boolean;
  fullMediaAccessGranted?: boolean;
};

// CHANGE ALSO IN src/renderer/src/types.ts
/**
 * Reply envelope the main renderer sends back for an AppletToParentRequest
 * relayed from a WAL window. Carrying the error explicitly lets the
 * relaying side reject right away instead of waiting out its timeout.
 */
export type AppletHostResponse =
  | { type: 'success'; result: unknown }
  | { type: 'error'; error: string };

/** Runtime check for an envelope that crossed IPC as an untyped value. */
export function isAppletHostResponse(value: unknown): value is AppletHostResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { type?: unknown; error?: unknown };
  if (v.type === 'success') return 'result' in v;
  return v.type === 'error' && typeof v.error === 'string';
}

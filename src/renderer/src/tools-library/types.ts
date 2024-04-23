import { EntryRecord } from '@holochain-open-dev/utils';
import { ActionHash, AgentPubKey } from '@holochain/client';

export type DeveloperCollective = {
  name: string;
  description: string;
  website: string;
  contact: string;
  icon: string;
  meta_data: string | undefined;
};

export type UpdateDeveloperCollectiveInput = {
  original_developer_collective_hash: ActionHash;
  previous_developer_collective_hash: ActionHash;
  updated_developer_collective: DeveloperCollective;
};

export type ContributorPermission = {
  for_collective: ActionHash;
  for_agent: AgentPubKey;
  expiry: number | undefined;
};

export type Curator = {
  name: string;
  description: string;
  icon: string;
  website: string | undefined;
  email: string | undefined;
  meta_data: string | undefined;
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

export type UpdatedTool = {
  // the developer_collective field cannot be updated
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

export type UpdateableEntity<T> = {
  originalActionHash: ActionHash;
  record: EntryRecord<T>;
};

export type UpdateToolInput = {
  original_tool_hash: ActionHash;
  previous_tool_hash: ActionHash;
  updated_tool: UpdatedTool;
};

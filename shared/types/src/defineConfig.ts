// Note: This file is also being used by the dev cli

export interface WeAppletDevInfo {
  config: WeaveDevConfig;
  tempDir: string;
  tempDirRoot: string;
  agentIdx: number;
  syncTime: number;
}

/**
 * Define a configuration file to run Moss in development mode with groups
 * and Tools pre-installed.
 *
 * @param config
 * @returns
 */
export function defineConfig(config: WeaveDevConfigInput) {
  return config;
}

/**
 * The shape of a dev config file as written by a Tool developer. Tools are
 * listed under `tools`; `applets` is the legacy spelling of the same field
 * and is still accepted so that existing config files keep working.
 */
export interface WeaveDevConfigInput {
  /**
   * Configuration for groups to create on startup
   */
  groups: GroupConfigInput[];
  /**
   * Configuration of available Tools to install into groups
   */
  tools?: ToolConfig[];
  /**
   * Legacy spelling of `tools`. Use `tools` in new config files.
   * @deprecated
   */
  applets?: ToolConfig[];
  /**
   * A list of URLs to Tool curations to use to populate the tool library additionally
   * to the Tools specified in the tools field. Can also be left empty.
   */
  toolCurations: ToolCurationConfig[];
}

export interface GroupConfigInput extends GroupConfigBase {
  /**
   * Tool instances to install to the group.
   */
  tools?: ToolInstallConfig[];
  /**
   * Legacy spelling of `tools`. Use `tools` in new config files.
   * @deprecated
   */
  applets?: ToolInstallConfig[];
}

/**
 * The dev config as the CLI and Moss consume it: every Tool list present and
 * under one name, whichever spelling the config file used.
 */
export interface WeaveDevConfig {
  groups: GroupConfig[];
  applets: ToolConfig[];
  toolCurations: ToolCurationConfig[];
}

export interface GroupConfig extends GroupConfigBase {
  applets: ToolInstallConfig[];
}

/**
 * Resolves the `tools`/`applets` spelling of a config file into the shape the
 * CLI consumes. A file that uses both spellings for the same list is rejected
 * rather than merged, because the two lists would almost certainly disagree.
 */
export function normalizeDevConfig(input: WeaveDevConfigInput): WeaveDevConfig {
  const pick = <T>(where: string, tools: T[] | undefined, applets: T[] | undefined): T[] => {
    if (tools && applets)
      throw new Error(
        `Invalid Weave dev config: use either "tools" or "applets" ${where}, not both.`,
      );
    return tools ?? applets ?? [];
  };
  const { tools, applets, groups, ...rest } = input;
  return {
    ...rest,
    applets: pick('at the top level', tools, applets),
    groups: (groups ?? []).map((group) => {
      const { tools, applets, ...groupRest } = group;
      return {
        ...groupRest,
        applets: pick(`in group '${group.name}'`, tools, applets),
      };
    }),
  };
}

export type ToolCurationConfig = {
  /**
   * URL to the curator's list of Tool curations
   */
  url: string;
  /**
   * Which curation lists to use from the curator at the given url
   */
  useLists: string[];
};

export interface ToolConfig {
  /**
   * Name of the Tool as it should appear in the Tool library
   */
  name: string;
  /**
   * Subtitle of the Tool as it should appear in the Tool library
   */
  subtitle: string;
  /**
   * Description of the Tool as it should appear in the Tool library
   */
  description: string;
  /**
   * Source for the icon of the Tool
   */
  icon: ResourceLocation;
  /**
   * Tags that may be used in Tool libraries
   */
  tags?: string[];
  /**
   * Where to get the .happ/.webhapp file from to install in devmode
   */
  source: WebHappLocation;
}

export interface GroupConfigBase {
  /**
   * Name of the group
   */
  name: string;
  /**
   * Network seed of the group. Must be unique.
   */
  networkSeed: string;
  /**
   * Source for the icon of the group
   */
  icon: ResourceLocation;
  /**
   * Agent that should create this group
   */
  creatingAgent: AgentSpecifier;
  /**
   * Agents that should join this group.
   * Note: The agentIdx of joining agents must be strictly greater than the agentIdx of the creating agent
   * since the group needs to be created first before other agents can join.
   */
  joiningAgents: AgentSpecifier[];
}

export type WebHappLocation =
  | {
      /**
       * Read the .webhapp file from a path on the filesystem.
       */
      type: 'filesystem';
      path: string;
    }
  | {
      /**
       * Take the .happ file from filesystem and serve the UI from localhost at the specified uiPort.
       * You are responsible for running the dev server of the happ's UI at the specified port.
       */
      type: 'localhost';
      happPath: string;
      uiPort: number;
    }
  | {
      /**
       * Fetch the .webhapp file from a URL
       */
      type: 'https';
      url: string;
    };

export type ResourceLocation =
  | {
      /**
       * Load the resource from a path on the filesystem
       */
      type: 'filesystem';
      path: string;
    }
  | {
      /**
       * Fetch the resource from a URL
       */
      type: 'https';
      url: string;
    };

export interface AgentSpecifier {
  /**
   * Agent index used to specify which agent to run the dev CLI with. An agent with agentIdx = 1 must exist
   * in your config file and must always be run as the first agent.
   */
  agentIdx: number;
  /**
   * Profile to use for this agent (same profile is used in all groups)
   */
  agentProfile: AgentProfile;
}

export interface ToolInstallConfig {
  /**
   * Name of the Tool, as given in the top-level `tools` list.
   */
  name: string;
  /**
   * Name to give to the Tool instance.
   */
  instanceName: string;
  /**
   * agentIdx of the agent that's supposed to register this Tool to the group.
   */
  registeringAgent: number;
  /**
   * Array of agentIdx of agents that should join this Tool instance that's being registered by the
   * registeringAgent.
   * The agentIdx of joining agents must be strictly greater than the agentIdx of the registering agent
   * since the Tool needs to be registered before it can be joined.
   */
  joiningAgents: number[];
}

export interface AgentProfile {
  nickname: string;
  avatar?: ResourceLocation;
}

/** @deprecated Use ToolConfig. */
export type AppletConfig = ToolConfig;
/** @deprecated Use ToolInstallConfig. */
export type AppletInstallConfig = ToolInstallConfig;

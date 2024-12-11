export interface WeAppletDevInfo {
    config: WeDevConfig;
    tempDir: string;
    tempDirRoot: string;
    agentIdx: number;
    syncTime: number;
}
/**
 * Define a configuration file to run We in development modes with groups
 * and applets pre-installed.
 *
 * @param config
 * @returns
 */
export declare function defineConfig(config: WeDevConfig): WeDevConfig;
export interface WeDevConfig {
    /**
     * Configuration for groups to create on startup
     */
    groups: GroupConfig[];
    /**
     * Configuration of available applets to install into groups
     */
    applets: AppletConfig[];
    /**
     * A list of URLs to Tool curations to use to populate the tool library additionally
     * to the Tools specified in the applets field. Can also be left empty.
     */
    toolCurations: ToolCurationConfig[];
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
export interface AppletConfig {
    /**
     * Name of the applet as it should appear in the applet library
     */
    name: string;
    /**
     * Subtitle of the applet as it should appear in the applet library
     */
    subtitle: string;
    /**
     * Description of the applet as it should appear in the applet library
     */
    description: string;
    /**
     * Source for the icon of the applet
     */
    icon: ResourceLocation;
    /**
     * Where to get the .happ/.webhapp file from to install in devmode
     */
    source: WebHappLocation;
}
export interface GroupConfig {
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
    /**
     * Applet instances to install to the group.
     */
    applets: AppletInstallConfig[];
}
export type WebHappLocation = {
    /**
     * Read the .webhapp file from a path on the filesystem.
     */
    type: 'filesystem';
    path: string;
} | {
    /**
     * Take the .happ file from filesystem and serve the UI from localhost at the specified uiPort.
     * You are responsible for running the dev server of the happ's UI at the specified port.
     */
    type: 'localhost';
    happPath: string;
    uiPort: number;
} | {
    /**
     * Fetch the .webhapp file from a URL
     */
    type: 'https';
    url: string;
};
export type ResourceLocation = {
    /**
     * Load the resource from a path on the filesystem
     */
    type: 'filesystem';
    path: string;
} | {
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
export interface AppletInstallConfig {
    /**
     * Name of the applet type.
     */
    name: string;
    /**
     * Name to give to the applet instance.
     */
    instanceName: string;
    /**
     * agentIdx of the agent that's supposed to register this applet to the group.
     */
    registeringAgent: number;
    /**
     * Array of agentIdx of agents that should join this applet instance that's being registered by the
     * registeringAgent.
     * The agentIdx of joining agents must be strictly greater than the agentIdx of the registering agent
     * since the applet needs to be registered before it can be joined.
     */
    joiningAgents: number[];
}
export interface AgentProfile {
    nickname: string;
    avatar?: ResourceLocation;
}

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
}
export interface AppletConfig {
    name: string;
    subtitle: string;
    description: string;
    icon: ResourceLocation;
    source: ResourceLocation;
}
export interface GroupConfig {
    name: string;
    networkSeed: string;
    icon: ResourceLocation;
    creatingAgent: AgentSpecifier;
    /**
     * joining agents must be strictly greater than the registering agent since it needs to be done sequentially
     */
    joiningAgents: AgentSpecifier[];
    applets: AppletInstallConfig[];
}
export type ResourceLocation = {
    type: 'filesystem';
    path: string;
} | {
    type: 'localhost';
    happPath: string;
    uiPort: number;
} | {
    type: 'https';
    url: string;
};
export interface AgentSpecifier {
    agentNum: number;
    agentProfile: AgentProfile;
}
export interface AppletInstallConfig {
    name: string;
    instanceName: string;
    registeringAgent: number;
    /**
     * joining agents must be strictly greater than the registering agent since it needs to be done sequentially
     */
    joiningAgents: number[];
}
export interface AgentProfile {
    nickname: string;
    avatar?: ResourceLocation;
}

import fs from 'fs';
import path from 'path';
import os from 'os';
import { nanoid } from 'nanoid';
import { breakingAppVersion } from '../filesystem';
import { AppletConfig, GroupConfig, WeDevConfig } from './defineConfig';
import tsNode from 'ts-node';

const SUPPORTED_APPLET_SOURCE_TYPES = ['localhost', 'filesystem', 'https'];
export const PRODUCTION_BOOTSTRAP_URLS = ['https://bootstrap.holo.host'];
export const PRODUCTION_SIGNALING_URLS = ['wss://signal.holo.host'];
export const APPLET_DEV_TMP_FOLDER_PREFIX = 'lightningrodlabs-we-applet-dev';

export interface WeAppletDevInfo {
  config: WeDevConfig;
  tempDir: string;
  agentIdx: number;
}

export interface CliOpts {
  profile?: string;
  devConfig?: string | undefined;
  agentIdx?: number | undefined;
  networkSeed?: string | undefined;
  bootstrapUrl?: string;
  signalingUrl?: string;
  forceProductionUrls?: boolean;
}

export interface RunOptions {
  profile: string | undefined;
  appstoreNetworkSeed: string;
  devInfo: WeAppletDevInfo | undefined;
  bootstrapUrl: string | undefined;
  signalingUrl: string | undefined;
}

export function validateArgs(args: CliOpts, app: Electron.App): RunOptions {
  const allowedProfilePattern = /^[0-9a-zA-Z-]+$/;
  if (args.profile && !allowedProfilePattern.test(args.profile)) {
    throw new Error(
      `The --profile argument may only contain digits (0-9), letters (a-z,A-Z) and dashes (-) but got '${args.profile}'`,
    );
  }
  if (args.agentIdx && !args.devConfig) {
    throw new Error(
      'The --agent-idx argument is only valid if a dev config file is passed as well via the --dev-config argument',
    );
  }
  if (
    typeof args.agentIdx !== 'undefined' &&
    (typeof args.agentIdx !== 'number' || isNaN(args.agentIdx))
  )
    throw new Error('--agent-idx argument must be of type number.');
  if (args.devConfig && !args.agentIdx)
    console.warn('[WARNING]: --agent-idx was argument not explicitly provided. Defaulting to "1".');
  if (args.devConfig) {
    if (
      args.bootstrapUrl &&
      PRODUCTION_BOOTSTRAP_URLS.includes(args.bootstrapUrl) &&
      !args.forceProductionUrls
    )
      throw new Error(
        'The production bootstrap server should not be used in development. Instead, you can spin up a local bootstrap and signaling server with hc run-local-services. If you explicitly want to use the production server, you need to provide the --force-production-urls flag.',
      );
    if (
      args.signalingUrl &&
      PRODUCTION_SIGNALING_URLS.includes(args.signalingUrl) &&
      !args.forceProductionUrls
    )
      throw new Error(
        'The production signaling server should not be used in development. Instead, you can spin up a local bootstrap and signaling server with hc run-local-services. If you explicitly want to use the production server, you need to provide the --force-production-urls flag.',
      );
  }

  let devInfo: WeAppletDevInfo | undefined;
  const devConfig: WeDevConfig | undefined = readAndValidateDevConfig(
    args.devConfig,
    args.agentIdx,
  );

  if (devConfig) {
    const agentIdx = args.agentIdx ? args.agentIdx : 1;
    devInfo = {
      config: devConfig,
      tempDir: path.join(
        os.tmpdir(),
        `${APPLET_DEV_TMP_FOLDER_PREFIX}-agent-${agentIdx}-${nanoid(8)}`,
      ),
      agentIdx,
    };
  }

  const profile = args.profile ? args.profile : undefined;
  // If provided take the one provided, otherwise check whether it's applet dev mode
  const appstoreNetworkSeed = args.networkSeed
    ? args.networkSeed
    : devConfig || !app.isPackaged
      ? `lightningrodlabs-we-applet-dev-${os.hostname()}`
      : `lightningrodlabs-we-${breakingAppVersion(app)}`;

  return {
    profile,
    appstoreNetworkSeed,
    devInfo,
    bootstrapUrl: args.bootstrapUrl,
    signalingUrl: args.signalingUrl,
  };
}

function readAndValidateDevConfig(
  configPath: string | undefined,
  agentIdx: number | undefined,
): WeDevConfig | undefined {
  if (!configPath) return undefined;
  if (agentIdx && agentIdx > 10) throw new Error('the --agent-idx argument cannot exceed 10.');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      'No dev config found at the given path. If run via we-dev-cli and not specified otherwise via --dev-config, a dev config called we.dev.config.ts is expected in the current working directory',
    );
  }

  let configObject: WeDevConfig | undefined;
  if (configPath.endsWith('.ts')) {
    tsNode.register();
    configObject = require(path.join(process.cwd(), configPath)).default;
  } else {
    const configString = fs.readFileSync(path.join(configPath), 'utf-8');
    try {
      const parseResult: WeDevConfig = JSON.parse(configString);
      configObject = parseResult;
    } catch (e) {
      throw new Error("Failed to parse config file. Make sure it's valid JSON.");
    }
  }
  if (!configObject) {
    throw new Error('Failed to read config object.');
  }

  const groups: GroupConfig[] = configObject!.groups ? configObject!.groups : [];
  const applets: AppletConfig[] = configObject!.applets ? configObject!.applets : [];

  // validate groups field
  groups.forEach((group) => {
    if (!group.name) throw new Error('Invalid We dev config: Contains a group without name.');
    if (!group.networkSeed)
      throw new Error(
        `Invalid We dev config: Group with name '${group.name}' is missing the "networkSeed" property of type string.`,
      );
    if (!group.icon)
      throw new Error(
        `Invalid We dev config: The group with name '${group.name}' has no icon provided.`,
      );
    if (!group.creatingAgent)
      throw new Error(
        `Invalid We dev config: No "creatingAgent" field provided for group '${group.name}'.`,
      );
    if (!group.creatingAgent.agentIdx)
      throw new Error(
        `Invalid We dev config: No "agentIdx" field provided in the "creatingAgent" field for group '${group.name}'`,
      );
    if (typeof group.creatingAgent.agentIdx !== 'number')
      throw new Error(
        `Invalid We dev config: "agentIdx" field provided in the "creatingAgent" field for group '${group.name}' must be of type 'number'.`,
      );
    if (!group.creatingAgent.agentProfile)
      throw new Error(
        `Invalid We dev config: No "agentProfile" field provided in the "creatingAgent" field of group '${group.name}'.`,
      );
    if (!group.creatingAgent.agentProfile.nickname)
      throw new Error(
        `Invalid We dev config: No "nickname" field provided in the "creatingAgent.agentProfile" field of group '${group.name}'.`,
      );
    if (!group.joiningAgents)
      throw new Error(
        `Invalid We dev config: no "joiningAgents" field of type array provided for group '${group.name}'. Add at least an empty array [].`,
      );
    group.joiningAgents.forEach((agent) => {
      if (!agent.agentIdx)
        throw new Error(
          `Invalid We dev config: Must provide an "agentIdx" field when specifying a "joiningAgent" for group ${group.name}`,
        );
      if (typeof agent.agentIdx !== 'number')
        throw new Error(
          `Invalid We dev config: "agentIdx" fields provided for "joiningAgents" in group ${group.name} in the we dev config file must be of type 'number'.`,
        );
      if (agent.agentIdx <= group.creatingAgent.agentIdx)
        throw new Error(
          `Invalid We dev config: "agentIdx" fields for agents in the "joiningAgent" must be strictly greater than the "agentIdx" field in "creatingAgent". Error occured for group ${group.name} in the we dev config.`,
        );
    });

    if (!group.applets)
      throw new Error(
        `Invalid We dev config: no "applets" field of type array provided for group '${group.name}'. Add at least an empty array [].`,
      );

    group.applets.forEach((applet) => {
      if (!applet.name || typeof applet.name !== 'string')
        throw new Error(
          `Invalid We dev config: Applets in the "groups.applets" field must have a "name" property of type string. The "name" property refers to the corresponding applet in the appstore.  The error occurred in group ${group.name}`,
        );
      // make sure that the applet has an applet config
      if (!applets.map((appletConfig) => appletConfig.name).includes(applet.name))
        throw new Error(
          'Invalid We dev config: Can only add applets to groups that are also defined in the root level "applets" field.',
        );
      if (!applet.instanceName || typeof applet.instanceName !== 'string')
        throw new Error(
          `Invalid We dev config: Applets in the "groups.applets" field must have an "instanceName" property of type string. The "instanceName" property defines the custom name of this applet instance used for installation. The error occurred in group ${group.name}`,
        );
      if (!applet.registeringAgent || typeof applet.registeringAgent !== 'number')
        throw new Error(
          `Invalid We dev config: Applets in the "groups.applets" field must have a "registeringAgent" property of type number. The error occurred in group ${group.name}`,
        );
      const joiningAgents = applet.joiningAgents ? applet.joiningAgents : [];
      joiningAgents.forEach((agent) => {
        if (typeof agent !== 'number')
          throw new Error('The "joiningAgents" field expects an array of numbers.');
        if (agent <= applet.registeringAgent)
          throw new Error(
            `Invalid We dev config: Every joining agent in the "joiningAgents" array must be strictly greater than the "registeringAgent". The error occurred in group ${group.name}`,
          );
      });
    });
    // Check that applet names are unique
    const appletInstanceNames = group.applets.map((applet) => applet.instanceName);
    const uniqueAppletInstanceNames = new Set(appletInstanceNames);
    if (uniqueAppletInstanceNames.size !== appletInstanceNames.length)
      throw new Error(
        `Invalid We dev config: The "instanceName" fields of applets in the "groups.applets" field in the we dev config must be unique per group. The error occurred in group ${group.name}`,
      );
  });

  const allGroupNetworkSeeds = groups.map((group) => group.networkSeed);
  const uniqueGroupNetworkSeeds = new Set(allGroupNetworkSeeds);
  if (uniqueGroupNetworkSeeds.size !== allGroupNetworkSeeds.length)
    throw new Error(`Invalid We dev config: Group network seeds must all be unique.`);

  // validate applets
  applets.forEach((applet) => {
    if (!applet.name || typeof applet.name !== 'string')
      throw new Error(
        `Invalid We dev config: Applets in the "applets" field must have a "name" property of type string. The "name" property refers to the corresponding applet in the appstore.`,
      );
    if (!applet.subtitle || typeof applet.subtitle !== 'string')
      throw new Error(
        `Invalid We dev config: Applets in the "applets" field must have a "subtitle" property of type string. The "subtitle" property refers to the subtitle that the applet will have in the appstore.`,
      );
    if (!applet.description || typeof applet.description !== 'string')
      throw new Error(
        `Invalid We dev config: Applets in the "applets" field must have a "description" property of type string. The "description" property refers to the description that the applet will have in the appstore.`,
      );
    if (!applet.icon)
      throw new Error(
        `Invalid We dev config: The applet with name '${applet.name}' has no icon provided.`,
      );
    if (!applet.source)
      throw new Error(
        `Invalid We dev config: Applets in the "applets" field of the we dev config mandatorily require a "source" attribute.`,
      );
    if (!SUPPORTED_APPLET_SOURCE_TYPES.includes(applet.source.type))
      throw new Error(
        `Invalid We dev config: Got invalid "type" in the "source" field of applet '${applet.name}': '${applet.source.type}'. Supported types are ${SUPPORTED_APPLET_SOURCE_TYPES}`,
      );
    switch (applet.source.type) {
      case 'filesystem':
        if (!applet.source.path || typeof applet.source.path !== 'string')
          throw new Error(
            `Invalid We dev config: No "path" field provided in the "source" field of type "filesystem" for applet '${applet.name}' or it is not of type string.`,
          );
        if (!fs.existsSync(applet.source.path)) {
          console.log('applet.source.path: ', applet.source.path);
          console.log('__dirname: ', __dirname);
          console.log('cwd: ', process.cwd());
          throw new Error(
            `Invalid We dev config: The "path" provided in the "source" field of applet '${applet.name}' does not exist.`,
          );
        }
        break;
      case 'https':
        if (
          !applet.source.url ||
          typeof applet.source.url !== 'string' ||
          !applet.source.url.startsWith('https://')
        )
          throw new Error(
            `Invalid We dev config: No "url" field provided in the "source" field of type "https" for applet '${applet.name}' is not a valid https URL.`,
          );
        break;
      case 'localhost':
        if (!applet.source.happPath || typeof applet.source.happPath !== 'string')
          throw new Error(
            `Invalid We dev config: No "happPath" field provided in the "source" field of type "localhost" for applet '${applet.name}' or it is not of type string.`,
          );
        if (!fs.existsSync(applet.source.happPath))
          throw new Error(
            `Invalid We dev config: The "happPath" provided in the "source" field of applet '${applet.name}' does not exist.`,
          );
        if (!applet.source.uiPort || typeof applet.source.uiPort !== 'number')
          throw new Error(
            `Invalid We dev config: No "uiPort" field provided in the "source" field of type "localhost" for applet '${applet.name}' or it is not of type number.`,
          );
    }
  });

  const allAppletNames = applets.map((applet) => applet.name);
  const uniqueAppletNames = new Set(allAppletNames);
  if (uniqueAppletNames.size !== allAppletNames.length)
    throw new Error(
      'Invalid We dev config: Names of applets in the "applets" field of the we dev config file must be unique.',
    );

  return configObject;
}

import fs from 'fs';
import os from 'os';
import path from 'path';
import mime from 'mime';

import { HolochainManager } from './holochainManager';
import { createHash, randomUUID } from 'crypto';
import { APPSTORE_APP_ID } from './sharedTypes';
import { DEFAULT_APPS_DIRECTORY } from './paths';
import {
  ActionHash,
  AgentPubKey,
  AppAgentWebsocket,
  AppInfo,
  EntryHash,
  HoloHashB64,
  encodeHashToBase64,
} from '@holochain/client';
import { AppletHash } from '@lightningrodlabs/we-applet';
import { AppAssetsInfo, WeFileSystem } from './filesystem';
import { net } from 'electron';
import { nanoid } from 'nanoid';
import { WeAppletDevInfo } from './cli';
import { EntryRecord } from '@holochain-open-dev/utils';

const rustUtils = require('hc-we-rust-utils');

export async function devSetup(
  config: WeAppletDevInfo,
  holochainManager: HolochainManager,
  weFileSystem: WeFileSystem,
): Promise<void> {
  const publishedApplets: Record<string, Entity<AppEntry>> = {};

  const appstoreClient = await AppAgentWebsocket.connect(
    new URL(`ws://127.0.0.1:${holochainManager.appPort}`),
    APPSTORE_APP_ID,
    4000,
  );
  const appstoreCells = await appstoreClient.appInfo();
  for (const [_role_name, [cell]] of Object.entries(appstoreCells.cell_info)) {
    await holochainManager.adminWebsocket.authorizeSigningCredentials(cell['provisioned'].cell_id, {
      All: null,
    });
  }

  for (const group of config.config.groups) {
    // If the running agent is supposed to create the group
    const isCreatingAgent = group.creatingAgent.agentNum === config.agentNum;
    const isJoiningAgent = group.joiningAgents
      .map((info) => info.agentNum)
      .includes(config.agentNum);

    const agentProfile = isCreatingAgent
      ? group.creatingAgent.agentProfile
      : isJoiningAgent
        ? group.joiningAgents.find((agent) => agent.agentNum === config.agentNum)?.agentProfile
        : undefined;

    if (agentProfile) {
      const groupWebsocket = await joinGroup(holochainManager, group, agentProfile);
      if (isCreatingAgent) {
        const icon_src = readIcon(group.icon);
        await groupWebsocket.callZome({
          role_name: 'group',
          zome_name: 'group',
          fn_name: 'set_group_profile',
          payload: {
            name: group.name,
            logo_src: icon_src,
          },
        });
      }

      for (const applet of group.applets) {
        const isRegisteringAgent = applet.registeringAgent === config.agentNum;
        const isJoiningAgent = applet.joiningAgents.includes(config.agentNum);

        const appletConfig = config.config.applets.find(
          (appStoreApplet) => appStoreApplet.name === applet.name,
        );
        if (!appletConfig)
          throw new Error(
            "Could not find AppletConfig for the applet that's supposed to be installed.",
          );

        const [happPath, happHash, maybeUiHash, maybeWebHappHash, maybeWebHappPath] =
          await fetchHappOrWebHappIfNecessary(weFileSystem, appletConfig.source);

        if (isRegisteringAgent) {
          // Check whether applet is already published to the appstore - if not publish it
          if (!Object.keys(publishedApplets).includes(appletConfig.name)) {
            const appletEntryResponse = await publishApplet(
              appstoreClient,
              appletConfig,
              maybeWebHappPath ? maybeWebHappPath : happPath,
            );
            publishedApplets[appletConfig.name] = appletEntryResponse.payload;
          }

          const networkSeed = randomUUID();
          const applet = {
            custom_name: appletConfig.name,
            description: appletConfig.description,
            appstore_app_hash: publishedApplets[appletConfig.name].action,
            network_seed: networkSeed,
            properties: {},
          };
          const appletHash = await groupWebsocket.callZome({
            role_name: 'group',
            zome_name: 'group',
            fn_name: 'hash_applet',
            payload: applet,
          });

          const appId = appIdFromAppletHash(appletHash);

          await installHapp(
            holochainManager,
            appId,
            networkSeed,
            groupWebsocket.myPubKey,
            happPath,
          );
          storeAppAssetsInfo(
            appletConfig,
            appId,
            weFileSystem,
            happPath,
            happHash,
            maybeWebHappHash,
            maybeWebHappHash,
            maybeUiHash,
          );
          await groupWebsocket.callZome({
            role_name: 'group',
            zome_name: 'group',
            fn_name: 'register_applet',
            payload: applet,
          });
        } else if (isJoiningAgent) {
          // Get unjoined applets and join them.

          const unjoinedApplets: Array<[EntryHash, AgentPubKey]> = await groupWebsocket.callZome({
            role_name: 'group',
            zome_name: 'group',
            fn_name: 'get_unjoined_applets',
            payload: null,
          });
          // This is best effort. If applets have not been gossiped over yet, the agent won't be able to join them
          // automatically
          for (const unjoinedApplet of unjoinedApplets) {
            const appletHash = unjoinedApplet[0];
            const appletRecord = await groupWebsocket.callZome({
              role_name: 'group',
              zome_name: 'group',
              fn_name: 'get_applet',
              payload: appletHash,
            });
            if (!appletRecord) {
              console.warn(
                `@group-client: @getApplet: No applet found for hash: ${encodeHashToBase64(
                  appletHash,
                )}`,
              );
              return undefined;
            }
            const entryRecord = new EntryRecord<Applet>(appletRecord).entry;

            const appId = appIdFromAppletHash(appletHash);

            await installHapp(
              holochainManager,
              appId,
              entryRecord.network_seed!,
              groupWebsocket.myPubKey,
              happPath,
            );
            storeAppAssetsInfo(
              appletConfig,
              appId,
              weFileSystem,
              happPath,
              happHash,
              maybeWebHappHash,
              maybeWebHappHash,
              maybeUiHash,
            );
            await groupWebsocket.callZome({
              role_name: 'group',
              zome_name: 'group',
              fn_name: 'register_applet',
              payload: applet,
            });
          }
        }
      }
    }
    // If the running agent is supposed to join the existing group
  }
}

async function joinGroup(
  holochainManager: HolochainManager,
  group: GroupConfig,
  agentProfile: AgentProfile,
): Promise<AppAgentWebsocket> {
  // Create the group
  console.log(`Installing group '${group.name}'...`);
  const appPort = holochainManager.appPort;
  // Install group cell
  const groupAppInfo = await installGroup(holochainManager, group.newtorkSeed);
  const groupWebsocket = await AppAgentWebsocket.connect(
    new URL(`ws://127.0.0.1:${appPort}`),
    groupAppInfo.installed_app_id,
  );
  const groupCells = await groupWebsocket.appInfo();
  for (const [_role_name, [cell]] of Object.entries(groupCells.cell_info)) {
    await holochainManager.adminWebsocket.authorizeSigningCredentials(cell['provisioned'].cell_id, {
      All: null,
    });
  }
  const avatarSrc = agentProfile.avatar ? readIcon(agentProfile.avatar) : undefined;
  await groupWebsocket.callZome({
    role_name: 'group',
    zome_name: 'profiles',
    fn_name: 'create_profile',
    payload: {
      nickname: agentProfile.nickname,
      fields: avatarSrc ? { avatar: avatarSrc } : undefined,
    },
  });
  return groupWebsocket;
}

function appIdFromAppletHash(appletHash: AppletHash): string {
  return `applet#${toLowerCaseB64(encodeHashToBase64(appletHash))}`;
}

function toLowerCaseB64(hashb64: HoloHashB64): string {
  return hashb64.replace(/[A-Z]/g, (match) => match.toLowerCase() + '$');
}

function readIcon(path: string) {
  const data = fs.readFileSync(path);
  const mimeType = mime.getType(path);
  return `data:${mimeType};base64,${data.toString('base64')}`;
}

async function installGroup(
  holochainManager: HolochainManager,
  networkSeed: string,
): Promise<AppInfo> {
  const apps = await holochainManager.adminWebsocket.listApps({});
  const hash = createHash('sha256');
  hash.update(networkSeed);
  const hashedSeed = hash.digest('base64');
  const appId = `group#${hashedSeed}`;
  const appStoreAppInfo = apps.find((appInfo) => appInfo.installed_app_id === APPSTORE_APP_ID);
  if (!appStoreAppInfo)
    throw new Error('Appstore must be installed before installing the first group.');
  const appInfo = await holochainManager.adminWebsocket.installApp({
    path: path.join(DEFAULT_APPS_DIRECTORY, 'we.happ'),
    installed_app_id: appId,
    agent_key: appStoreAppInfo.agent_pub_key,
    network_seed: networkSeed,
    membrane_proofs: {},
  });
  await holochainManager.adminWebsocket.enableApp({ installed_app_id: appId });
  return appInfo;
}

async function fetchHappOrWebHappIfNecessary(
  weFileSystem: WeFileSystem,
  source: WebHappLocation,
): Promise<[string, string, string | undefined, string | undefined, string | undefined]> {
  switch (source.type) {
    case 'https': {
      const response = await net.fetch(source.url);
      const buffer = await response.arrayBuffer();
      const tmpDir = path.join(os.tmpdir(), `we-applet-${nanoid(8)}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      const happOrWebHappPath = path.join(tmpDir, 'applet_to_install.webhapp');
      fs.writeFileSync(happOrWebHappPath, new Uint8Array(buffer));

      const uisDir = path.join(weFileSystem.uisDir);
      const happsDir = path.join(weFileSystem.happsDir);
      const result: string = await rustUtils.saveHappOrWebhapp(happOrWebHappPath, uisDir, happsDir);
      // webHappHash should only be returned if it is actually a webhapp
      const [happFilePath, happHash, uiHash, webHappHash] = result.split('$');
      return [
        happFilePath,
        happHash,
        uiHash ? uiHash : undefined,
        webHappHash ? webHappHash : undefined,
        webHappHash ? happOrWebHappPath : undefined,
      ];
    }
    case 'filesystem': {
      const happOrWebHappPath = source.path;
      const uisDir = path.join(weFileSystem.uisDir);
      const happsDir = path.join(weFileSystem.happsDir);
      const result: string = await rustUtils.saveHappOrWebhapp(happOrWebHappPath, uisDir, happsDir);
      const [happFilePath, happHash, uiHash, webHappHash] = result.split('$');
      return [
        happFilePath,
        happHash,
        uiHash ? uiHash : undefined,
        webHappHash ? webHappHash : undefined,
        webHappHash ? happOrWebHappPath : undefined,
      ];
    }
    case 'localhost':
      const happBytes = fs.readFileSync(source.happPath);
      const hash = createHash('sha256');
      hash.update(happBytes);
      const happHash = hash.digest('base64');
      return [source.happPath, happHash, undefined, undefined, undefined];
    default:
      throw new Error(`Got invalid applet source: ${source}`);
  }
}

async function installHapp(
  holochainManager: HolochainManager,
  appId: string,
  networkSeed: string,
  pubKey: AgentPubKey,
  happPath: string,
): Promise<void> {
  await holochainManager.adminWebsocket.installApp({
    path: happPath,
    installed_app_id: appId,
    agent_key: pubKey,
    network_seed: networkSeed,
    membrane_proofs: {},
  });
  await holochainManager.adminWebsocket.enableApp({ installed_app_id: appId });
}

async function publishApplet(
  appstoreClient: AppAgentWebsocket,
  appletConfig: AppletConfig,
  happOrWebHappPath: string,
): Promise<DevHubResponse<Entity<AppEntry>>> {
  const publisher: DevHubResponse<Entity<PublisherEntry>> = await appstoreClient.callZome({
    role_name: 'appstore',
    zome_name: 'appstore_api',
    fn_name: 'create_publisher',
    payload: {
      name: 'applet-developer',
      location: {
        country: 'in',
        region: 'frontof',
        city: 'myscreen',
      },
      website: {
        url: 'https://duckduckgo.com',
      },
      icon_src: 'unnecessary',
    },
  });

  const source = JSON.stringify({
    type: 'https',
    url: `file://${happOrWebHappPath}`,
  });

  const appletIcon = readIcon(appletConfig.icon);

  const payload = {
    title: appletConfig.name,
    subtitle: appletConfig.name,
    description: appletConfig.description,
    icon_src: appletIcon,
    publisher: publisher.payload.id,
    source,
    hashes: 'undefined',
    metadata:
      appletConfig.source.type === 'localhost'
        ? JSON.stringify({ uiPort: appletConfig.source.uiPort })
        : undefined,
  };
  console.log('@publishApplet: payload: ', payload);
  console.log('@publishApplet: appletConfig.source: ', appletConfig.source);

  return appstoreClient.callZome({
    role_name: 'appstore',
    zome_name: 'appstore_api',
    fn_name: 'create_app',
    payload,
  });
}

function storeAppAssetsInfo(
  appletConfig: AppletConfig,
  appId: string,
  weFileSystem: WeFileSystem,
  happPath: string,
  happHash: string,
  maybeWebHappPath?: string,
  maybeWebHappHash?: string,
  maybeUiHash?: string,
) {
  // TODO Store more app metadata
  // Store app metadata
  const appAssetsInfo: AppAssetsInfo =
    appletConfig.source.type === 'localhost'
      ? {
          type: 'webhapp',
          source: {
            type: 'https',
            url: `file://${happPath}`,
          },
          happ: {
            sha256: happHash,
          },
          ui: {
            location: {
              type: 'localhost',
              port: appletConfig.source.uiPort,
            },
          },
        }
      : maybeWebHappHash
        ? {
            type: 'webhapp',
            sha256: maybeWebHappHash,
            source: {
              type: 'https',
              url: `file://${maybeWebHappPath}`,
            },
            happ: {
              sha256: happHash,
            },
            ui: {
              location: {
                type: 'filesystem',
                sha256: maybeUiHash!,
              },
            },
          }
        : {
            type: 'happ',
            sha256: happHash,
            source: {
              type: 'https',
              url: `file://${happPath}`,
            },
          };
  fs.writeFileSync(
    path.join(weFileSystem.appsDir, `${appId}.json`),
    JSON.stringify(appAssetsInfo, undefined, 4),
  );
}

export interface WeDevConfig {
  groups: GroupConfig[];
  applets: AppletConfig[];
}

export interface GroupConfig {
  name: string;
  newtorkSeed: string;
  icon: string; // path to icon
  creatingAgent: AgentSpecifier;
  /**
   * joining agents must be strictly greater than the registering agent since it needs to be done sequentially
   */
  joiningAgents: AgentSpecifier[];
  applets: AppletInstallConfig[];
}

export interface AgentSpecifier {
  agentNum: number;
  agentProfile: AgentProfile;
}

export interface AgentProfile {
  nickname: string;
  avatar?: string; // path to icon
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
export interface AppletConfig {
  name: string;
  subtitle: string;
  description: string;
  icon: string;
  source: WebHappLocation;
}

export type WebHappLocation =
  | {
      type: 'filesystem';
      path: string;
    }
  | {
      type: 'localhost';
      happPath: string;
      uiPort: number;
    }
  | {
      type: 'https';
      url: string;
    };

export interface DevHubResponse<T> {
  type: 'success' | 'failure';
  metadata: any;
  payload: T;
}

export interface Entity<T> {
  id: ActionHash;
  action: ActionHash;
  address: EntryHash;
  ctype: string;
  content: T;
}

export interface PublisherEntry {
  name: string;
  location: LocationTriplet;
  website: WebAddress;
  icon_src: String;
  editors: Array<AgentPubKey>;

  // common fields
  author: AgentPubKey;
  published_at: number;
  last_updated: number;
  metadata: any;

  // optional
  description: string | undefined;
  email: string | undefined;
  deprecation: any;
}

export interface AppEntry {
  title: string;
  subtitle: string;
  description: string;
  icon_src: string;
  publisher: ActionHash; // alias EntityId
  source: string;
  hashes: string;
  metadata: string;
  editors: Array<AgentPubKey>;

  author: AgentPubKey;
  published_at: number;
  last_updated: number;
  deprecation?: {
    message: string;
    recommended_alternatives: any;
  };
}

export interface Applet {
  custom_name: string; // name of the applet instance as chosen by the person adding it to the group,
  description: string;
  appstore_app_hash: ActionHash;
  network_seed: string | undefined;
  properties: Record<string, Uint8Array>; // Segmented by RoleId
}

export interface WebAddress {
  url: string;
  context: string | undefined;
}

export interface LocationTriplet {
  country: string;
  region: string;
  city: string;
}

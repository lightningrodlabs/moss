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
  fakeActionHash,
} from '@holochain/client';
import { AppletHash } from '@lightningrodlabs/we-applet';
import { AppAssetsInfo, WeFileSystem } from './filesystem';
import { net } from 'electron';
import { nanoid } from 'nanoid';

const rustUtils = require('hc-we-rust-utils');

export async function devSetup(
  config: WeDevConfig,
  holochainManager: HolochainManager,
  weFileSystem: WeFileSystem,
): Promise<void> {
  // Create groups
  const groupInstallations = config.groups.map((group) => async () => {
    console.log(`Installing group '${group.name}'...`);
    const icon_src = group.icon ? readIcon(group.icon) : 'undefined';
    const appPort = holochainManager.appPort;
    // Install group cell
    const groupAppInfo = await createGroup(holochainManager);
    const groupWebsocket = await AppAgentWebsocket.connect(
      new URL(`ws://127.0.0.1:${appPort}`),
      groupAppInfo.installed_app_id,
    );
    const groupCells = await groupWebsocket.appInfo();
    for (const [_role_name, [cell]] of Object.entries(groupCells.cell_info)) {
      await holochainManager.adminWebsocket.authorizeSigningCredentials(
        cell['provisioned'].cell_id,
        {
          All: null,
        },
      );
    }
    await groupWebsocket.callZome({
      role_name: 'group',
      zome_name: 'group',
      fn_name: 'set_group_profile',
      payload: {
        name: group.name,
        logo_src: icon_src,
      },
    });
    // install all applets
    const appletInstallations = group.applets.map((appletConfig) => async () => {
      console.log(
        `Publishing and installing applet '${appletConfig.name}' of group '${group.name}'...`,
      );

      const [happPath, happHash, maybeUiHash, maybeWebHappHash, maybeWebHappPath] =
        await fetchHappOrWebHappIfNecessary(weFileSystem, appletConfig.source);
      // Install and register applets. Write correct AppletAssetsConfig
      const appletEntryResponse = await publishApplet(
        holochainManager,
        appletConfig,
        maybeWebHappPath ? maybeWebHappPath : happPath,
      );

      const networkSeed = randomUUID();
      const applet = {
        custom_name: appletConfig.name,
        description: appletConfig.description,
        appstore_app_hash: appletEntryResponse.payload.action,
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

      await installHapp(holochainManager, appId, networkSeed, groupWebsocket.myPubKey, happPath);

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

      // register applet
      await groupWebsocket.callZome({
        role_name: 'group',
        zome_name: 'group',
        fn_name: 'register_applet',
        payload: applet,
      });
    });

    // Install sequentially to omit source chain head moved error
    for (const appletInstallation of appletInstallations) {
      await appletInstallation();
    }
  });

  // Install sequentially to omit source chain head moved error
  for (const groupInstallation of groupInstallations) {
    await groupInstallation();
  }
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

async function createGroup(holochainManager: HolochainManager): Promise<AppInfo> {
  const apps = await holochainManager.adminWebsocket.listApps({});
  const networkSeed = randomUUID();
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
  holochainManager: HolochainManager,
  appletConfig: AppletConfig,
  happOrWebHappPath: string,
): Promise<DevHubResponse<Entity<PublisherEntry>>> {
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

  return appstoreClient.callZome({
    role_name: 'appstore',
    zome_name: 'appstore_api',
    fn_name: 'create_app',
    payload: {
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
    },
  });
}

export interface WeDevConfig {
  groups: GroupConfig[];
}

interface GroupConfig {
  name: string;
  icon: string; // path to icon
  agentProfile: {
    nickname: string;
    avatar: string; // path to icon
  };
  applets: AppletConfig[];
}

interface AppletConfig {
  name: string;
  description: string;
  icon: string;
  source: WebHappLocation;
}

type WebHappLocation =
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

export interface WebAddress {
  url: string;
  context: string | undefined;
}

export interface LocationTriplet {
  country: string;
  region: string;
  city: string;
}

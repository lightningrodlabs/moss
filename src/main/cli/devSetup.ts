import fs from 'fs';
import os from 'os';
import path from 'path';
import mime from 'mime';

import { HolochainManager } from '../holochainManager';
import { createHash, randomUUID } from 'crypto';
import { TOOLS_LIBRARY_APP_ID, AppHashes, Tool, DeveloperCollective } from '../sharedTypes';
import { DEFAULT_APPS_DIRECTORY } from '../paths';
import {
  ActionHash,
  AgentPubKey,
  AppWebsocket,
  AppInfo,
  DnaHashB64,
  EntryHash,
  HoloHashB64,
  Link,
  encodeHashToBase64,
  Record as HolochainRecord,
  GrantedFunctionsType,
} from '@holochain/client';
import { AppletHash } from '@theweave/api';
import { AppAssetsInfo, DistributionInfo, MossFileSystem } from '../filesystem';
import { net } from 'electron';
import { nanoid } from 'nanoid';
import { WeAppletDevInfo } from './cli';
import * as childProcess from 'child_process';
import split from 'split';
import {
  AgentProfile,
  AppletConfig,
  GroupConfig,
  ResourceLocation,
  WebHappLocation,
} from './defineConfig';
import { EntryRecord } from '@holochain-open-dev/utils';
import * as rustUtils from '@lightningrodlabs/we-rust-utils';
import * as yaml from 'js-yaml';
import { HC_BINARY } from '../binaries';

// const rustUtils = require('@lightningrodlabs/we-rust-utils');

export async function readLocalServices(): Promise<[string, string]> {
  if (!fs.existsSync('.hc_local_services')) {
    throw new Error(
      'No .hc_local_services file found. Make sure agent with agentIdx 1 is running before you start additional agents.',
    );
  }
  const localServicesString = fs.readFileSync('.hc_local_services', 'utf-8');
  try {
    const { bootstrapUrl, signalingUrl } = JSON.parse(localServicesString);
    return [bootstrapUrl, signalingUrl];
  } catch (e) {
    throw new Error('Failed to parse content of .hc_local_services');
  }
}

export async function startLocalServices(): Promise<
  [string, string, childProcess.ChildProcessWithoutNullStreams]
> {
  if (fs.existsSync('.hc_local_services')) {
    fs.rmSync('.hc_local_services');
  }
  const hcBinaryInResources = fs.existsSync(HC_BINARY);
  if (!hcBinaryInResources)
    console.warn(
      '\n\n###################\n\nWARNING: No hc binary found in the resources folder. Using hc from the environment instead which may cause problems if its version is not compatible with the holochain version used by Moss.\n\n###################\n\n',
    );

  const hcBinary = hcBinaryInResources ? HC_BINARY : 'hc';

  const localServicesHandle = childProcess.spawn(hcBinary, ['run-local-services']);
  return new Promise((resolve) => {
    let bootstrapUrl;
    let signalingUrl;
    let bootstrapRunning = false;
    let signalRunnig = false;
    localServicesHandle.stdout.pipe(split()).on('data', async (line: string) => {
      console.log(`[weave-cli] | [hc run-local-services]: ${line}`);
      if (line.includes('HC BOOTSTRAP - ADDR:')) {
        bootstrapUrl = line.split('# HC BOOTSTRAP - ADDR:')[1].trim();
      }
      if (line.includes('HC SIGNAL - ADDR:')) {
        signalingUrl = line.split('# HC SIGNAL - ADDR:')[1].trim();
      }
      if (line.includes('HC BOOTSTRAP - RUNNING')) {
        bootstrapRunning = true;
      }
      if (line.includes('HC SIGNAL - RUNNING')) {
        signalRunnig = true;
      }
      fs.writeFileSync('.hc_local_services', JSON.stringify({ bootstrapUrl, signalingUrl }));
      if (bootstrapRunning && signalRunnig)
        resolve([bootstrapUrl, signalingUrl, localServicesHandle]);
    });
    localServicesHandle.stderr.pipe(split()).on('data', async (line: string) => {
      console.log(`[weave-cli] | [hc run-local-services] ERROR: ${line}`);
    });
  });
}

export async function devSetup(
  config: WeAppletDevInfo,
  holochainManager: HolochainManager,
  mossFileSystem: MossFileSystem,
): Promise<void> {
  const logDevSetup = (msg) => console.log(`[weave-cli] | [Agent ${config.agentIdx}]: ${msg}`);
  logDevSetup(`Setting up agent ${config.agentIdx}.`);
  const publishedApplets: Record<string, EntryRecord<Tool>> = {};
  const installableApplets: Record<
    string,
    [string, string, string | undefined, string | undefined, string | undefined]
  > = {};

  for (const installableApplet of config.config.applets) {
    if (
      config.config.groups
        .map((group) => group.applets.map((applet) => applet.name))
        .flat()
        .includes(installableApplet.name)
    ) {
      logDevSetup(
        `Fetching applet '${installableApplet.name}' from source specified in the config file...`,
      );

      installableApplets[installableApplet.name] = await fetchHappOrWebHappIfNecessary(
        mossFileSystem,
        installableApplet.source,
      );
    }
  }

  const toolsLibraryAuthenticationResponse =
    await holochainManager.adminWebsocket.issueAppAuthenticationToken({
      installed_app_id: TOOLS_LIBRARY_APP_ID,
      single_use: false,
      expiry_seconds: 99999999,
    });

  const toolsLibraryClient = await AppWebsocket.connect({
    url: new URL(`ws://127.0.0.1:${holochainManager.appPort}`),
    wsClientOptions: {
      origin: 'moss-admin',
    },
    token: toolsLibraryAuthenticationResponse.token,
    defaultTimeout: 4000,
  });
  const toolsLibraryCells = await toolsLibraryClient.appInfo();
  let toolsLibraryDnaHash: DnaHashB64 | undefined = undefined;
  for (const [_role_name, [cell]] of Object.entries(toolsLibraryCells.cell_info)) {
    await holochainManager.adminWebsocket.authorizeSigningCredentials(
      cell['provisioned'].cell_id,
      GrantedFunctionsType.All,
    );
    toolsLibraryDnaHash = encodeHashToBase64(cell['provisioned'].cell_id[0]);
  }

  if (!toolsLibraryDnaHash) throw new Error('Failed to determine appstore DNA hash.');

  for (const group of config.config.groups) {
    // If the running agent is supposed to create the group
    const isCreatingAgent = group.creatingAgent.agentIdx === config.agentIdx;
    const isJoiningAgent = group.joiningAgents
      .map((info) => info.agentIdx)
      .includes(config.agentIdx);

    const agentProfile = isCreatingAgent
      ? group.creatingAgent.agentProfile
      : isJoiningAgent
        ? group.joiningAgents.find((agent) => agent.agentIdx === config.agentIdx)?.agentProfile
        : undefined;

    if (agentProfile) {
      logDevSetup(`Installing group '${group.name}'...`);
      const groupWebsocket = await joinGroup(holochainManager, group, agentProfile);
      if (isCreatingAgent) {
        logDevSetup(`Creating group profile for group '${group.name}'...`);
        const icon_src = await readIcon(group.icon);
        await groupWebsocket.callZome({
          role_name: 'group',
          zome_name: 'group',
          fn_name: 'set_group_profile',
          payload: {
            name: group.name,
            icon_src: icon_src,
          },
        });
      }

      const unjoinedApplets: Array<[EntryHash, Applet]> = [];

      if (!isCreatingAgent) {
        // Wait 5 seconds to give some time for applets to gossip
        console.log(
          `Waiting ${config.syncTime} ms for tools to gossip... (this duration can be tweaked using the --sync-time argument)`,
        );
        await new Promise((res) => setTimeout(res, config.syncTime));
        // Get unjoined applets. This is best effort. If applets have not been gossiped over yet, the agent won't
        // be able to join them automatically
        logDevSetup(`Fetching tools to join for group '${group.name}'...`);

        // Look for unjoined applets
        const unjoinedAppletsArray: Array<[EntryHash, AgentPubKey, number]> =
          await groupWebsocket.callZome({
            role_name: 'group',
            zome_name: 'group',
            fn_name: 'get_unjoined_applets',
            payload: null,
          });
        if (unjoinedApplets.length === 0) {
          logDevSetup(
            'Found no tools to join yet. Skipping...You will need to install them manually in the UI once they are gossiped over.',
          );
        }

        // Fetch Applet entry for each
        for (const unjoinedApplet of unjoinedAppletsArray) {
          const appletHash = unjoinedApplet[0];
          const applet: Applet | undefined = await groupWebsocket.callZome({
            role_name: 'group',
            zome_name: 'group',
            fn_name: 'get_applet',
            payload: appletHash,
          });

          if (!applet) {
            logDevSetup(
              `Applet with entryhash ${encodeHashToBase64(
                appletHash,
              )} not found in group DHT yet. Skipping...`,
            );
          } else {
            const appletInfo = [unjoinedApplet[0], applet];
            unjoinedApplets.push(appletInfo as [EntryHash, Applet]);
          }
        }

        logDevSetup(
          `Found applets to join:\n${unjoinedApplets.map(
            ([_eh, applet]) => `${applet.custom_name}`,
          )}`,
        );
      }

      for (const appletInstallConfig of group.applets) {
        const isRegisteringAgent = appletInstallConfig.registeringAgent === config.agentIdx;
        const isJoiningAgent = appletInstallConfig.joiningAgents.includes(config.agentIdx);

        const appletConfig = config.config.applets.find(
          (appStoreApplet) => appStoreApplet.name === appletInstallConfig.name,
        );
        if (!appletConfig)
          throw new Error(
            "Could not find AppletConfig for the applet that's supposed to be installed.",
          );

        if (isRegisteringAgent) {
          const [happPath, happHash, maybeUiHash, maybeWebHappHash, maybeWebHappPath] =
            installableApplets[appletInstallConfig.name];

          const appHashes: AppHashes =
            maybeUiHash && maybeWebHappHash
              ? {
                  type: 'webhapp',
                  sha256: maybeWebHappHash,
                  happ: {
                    sha256: happHash,
                  },
                  ui: {
                    sha256: maybeUiHash,
                  },
                }
              : {
                  type: 'happ',
                  sha256: happHash,
                };

          // Check whether applet is already published to the appstore - if not publish it
          if (!Object.keys(publishedApplets).includes(appletConfig.name)) {
            logDevSetup(`Publishing applet '${appletInstallConfig.name}' to appstore...`);
            const toolRecord = await publishApplet(
              toolsLibraryClient,
              appletConfig,
              maybeWebHappPath ? maybeWebHappPath : happPath,
              appHashes,
            );
            publishedApplets[appletConfig.name] = toolRecord;
          }

          const toolRecord = publishedApplets[appletConfig.name];

          const distributionInfo: DistributionInfo = {
            type: 'tools-library',
            info: {
              toolsLibraryDnaHash,
              originalToolActionHash: encodeHashToBase64(toolRecord.actionHash),
              toolVersionActionHash: encodeHashToBase64(toolRecord.actionHash),
              toolVersionEntryHash: encodeHashToBase64(toolRecord.entryHash),
            },
          };

          const networkSeed = randomUUID();
          const applet: Applet = {
            custom_name: appletInstallConfig.instanceName,
            description: appletConfig.description,
            sha256_happ: happHash,
            sha256_ui: maybeUiHash,
            sha256_webhapp: maybeWebHappHash,
            distribution_info: JSON.stringify(distributionInfo),
            meta_data: undefined,
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
          const appletPubKey = groupWebsocket.myPubKey;
          logDevSetup(`Installing applet instance '${appletInstallConfig.instanceName}'...`);
          await installHapp(holochainManager, appId, networkSeed, appletPubKey, happPath);
          storeAppAssetsInfo(
            appletConfig,
            appId,
            mossFileSystem,
            distributionInfo,
            happPath,
            happHash,
            maybeWebHappPath,
            maybeWebHappHash,
            maybeUiHash,
          );
          logDevSetup(`Registering applet instance '${appletInstallConfig.instanceName}'...`);
          await groupWebsocket.callZome({
            role_name: 'group',
            zome_name: 'group',
            fn_name: 'register_and_join_applet',
            payload: {
              applet,
              joining_pubkey: appletPubKey,
            },
          });
        } else if (isJoiningAgent) {
          const maybeUnjoinedApplet = unjoinedApplets.find(
            ([_entryHash, applet]) => applet.custom_name === appletInstallConfig.instanceName,
          );

          if (maybeUnjoinedApplet) {
            logDevSetup(`Joining applet instance ${appletInstallConfig.instanceName} ...`);

            const [appletHash, applet] = maybeUnjoinedApplet;

            const appId = appIdFromAppletHash(appletHash);

            const [happPath, happHash, maybeUiHash, maybeWebHappHash, maybeWebHappPath] =
              installableApplets[appletInstallConfig.name];

            const appletPubKey = groupWebsocket.myPubKey;

            await installHapp(
              holochainManager,
              appId,
              applet.network_seed!,
              appletPubKey,
              happPath,
            );
            storeAppAssetsInfo(
              appletConfig,
              appId,
              mossFileSystem,
              JSON.parse(applet.distribution_info),
              happPath,
              happHash,
              maybeWebHappPath,
              maybeWebHappHash,
              maybeUiHash,
            );
            await groupWebsocket.callZome({
              role_name: 'group',
              zome_name: 'group',
              fn_name: 'join_applet',
              payload: {
                applet,
                joining_pubkey: appletPubKey,
              },
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
  progenitor?: AgentPubKey,
): Promise<AppWebsocket> {
  // Create the group
  const appPort = holochainManager.appPort;
  // Install group cell
  const groupAppInfo = await installGroup(holochainManager, group.networkSeed, progenitor);
  const groupAuthenticationTokenResponse =
    await holochainManager.adminWebsocket.issueAppAuthenticationToken({
      installed_app_id: groupAppInfo.installed_app_id,
      single_use: false,
      expiry_seconds: 99999999,
    });
  const groupWebsocket = await AppWebsocket.connect({
    url: new URL(`ws://127.0.0.1:${appPort}`),
    wsClientOptions: {
      origin: 'moss-admin',
    },
    token: groupAuthenticationTokenResponse.token,
  });
  const groupCells = await groupWebsocket.appInfo();
  for (const [_role_name, [cell]] of Object.entries(groupCells.cell_info)) {
    await holochainManager.adminWebsocket.authorizeSigningCredentials(
      cell['provisioned'].cell_id,
      GrantedFunctionsType.All,
    );
  }
  const avatarSrc = agentProfile.avatar ? await readIcon(agentProfile.avatar) : undefined;
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

async function readIcon(location: ResourceLocation) {
  switch (location.type) {
    case 'filesystem': {
      const data = fs.readFileSync(location.path);
      const mimeType = mime.getType(location.path);
      return `data:${mimeType};base64,${data.toString('base64')}`;
    }
    case 'https': {
      const response = await net.fetch(location.url);
      const arrayBuffer = await response.arrayBuffer();
      const mimeType = mime.getType(location.url);
      return `data:${mimeType};base64,${_arrayBufferToBase64(arrayBuffer)}`;
    }

    default:
      throw new Error(
        `Fetching icon from source type ${
          (location as any).type
        } is not implemented. Got icon source: ${location}.`,
      );
  }
}

async function installGroup(
  holochainManager: HolochainManager,
  networkSeed: string,
  progenitor?: AgentPubKey,
): Promise<AppInfo> {
  const apps = await holochainManager.adminWebsocket.listApps({});
  const appStoreAppInfo = apps.find((appInfo) => appInfo.installed_app_id === TOOLS_LIBRARY_APP_ID);
  if (!appStoreAppInfo)
    throw new Error('Appstore must be installed before installing the first group.');

  const hash = createHash('sha256');
  hash.update(networkSeed);
  const hashedSeed = hash.digest('base64');
  const appId = `group#${hashedSeed}#${progenitor ? encodeHashToBase64(appStoreAppInfo?.agent_pub_key) : null}`;

  const groupHappPath = path.join(DEFAULT_APPS_DIRECTORY, 'group.happ');
  const dnaPropertiesMap = progenitor
    ? {
        group: yaml.dump({ progenitor: encodeHashToBase64(progenitor) }),
      }
    : {
        group: yaml.dump({
          progenitor: null,
        }),
      };

  console.log('Dna properties map: ', dnaPropertiesMap);
  const modifiedHappBytes = await rustUtils.happBytesWithCustomProperties(
    groupHappPath,
    dnaPropertiesMap,
  );

  const modifiedHappPath = path.join(os.tmpdir(), `group-happ-${nanoid(8)}.happ`);

  fs.writeFileSync(modifiedHappPath, new Uint8Array(modifiedHappBytes));

  const appInfo = await holochainManager.adminWebsocket.installApp({
    path: modifiedHappPath,
    installed_app_id: appId,
    agent_key: appStoreAppInfo.agent_pub_key,
    network_seed: networkSeed,
    membrane_proofs: {},
  });
  fs.rmSync(modifiedHappPath);
  await holochainManager.adminWebsocket.enableApp({ installed_app_id: appId });
  return appInfo;
}

async function fetchHappOrWebHappIfNecessary(
  mossFileSystem: MossFileSystem,
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

      const uisDir = path.join(mossFileSystem.uisDir);
      const happsDir = path.join(mossFileSystem.happsDir);
      const result: string = await rustUtils.saveHappOrWebhapp(happOrWebHappPath, uisDir, happsDir);
      fs.rmSync(tmpDir, { recursive: true });
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
      const uisDir = path.join(mossFileSystem.uisDir);
      const happsDir = path.join(mossFileSystem.happsDir);
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
      const result: string = await rustUtils.validateHappOrWebhapp(
        Array.from(new Uint8Array(happBytes)),
      );
      const [happSha256] = result.split('$');
      return [source.happPath, happSha256, undefined, undefined, undefined];
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
  appstoreClient: AppWebsocket,
  appletConfig: AppletConfig,
  happOrWebHappPath: string,
  appHashes: AppHashes,
): Promise<EntryRecord<Tool>> {
  // Check whether developer collective has already been created, if not create one
  let developerCollectiveHash: ActionHash;
  const links: Array<Link> = await appstoreClient.callZome({
    role_name: 'tools',
    zome_name: 'library',
    fn_name: 'get_my_developer_collective_links',
    payload: null,
  });

  if (links.length === 0) {
    const payload: DeveloperCollective = {
      name: 'Dummy Developer Collective',
      description: 'Just a dummy collective created in dev mode',
      website: 'https://dummycollective.dev',
      contact: 'void',
      icon: 'invalid icon',
      meta_data: undefined,
    };
    const record: HolochainRecord = await appstoreClient.callZome(
      {
        role_name: 'tools',
        zome_name: 'library',
        fn_name: 'create_developer_collective',
        payload,
      },
      10000,
    );
    developerCollectiveHash = record.signed_action.hashed.hash;
  } else {
    developerCollectiveHash = links[0].target;
  }

  // Create Tool entry

  // TODO: Potentially change this to be taken from the original source or a local cache
  // Instead of pointing to local temp files
  const source = JSON.stringify({
    type: 'https',
    url: `file://${happOrWebHappPath}`,
  });

  const appletIcon = await readIcon(appletConfig.icon);

  const payload: Tool = {
    developer_collective: developerCollectiveHash,
    permission_hash: developerCollectiveHash,
    title: appletConfig.name,
    subtitle: appletConfig.subtitle,
    description: appletConfig.description,
    icon: appletIcon,
    version: '0.1.0',
    source,
    hashes: JSON.stringify(appHashes),
    changelog: undefined,
    meta_data:
      appletConfig.source.type === 'localhost'
        ? JSON.stringify({ uiPort: appletConfig.source.uiPort })
        : undefined,
    deprecation: undefined,
  };

  const toolRecord = await appstoreClient.callZome({
    role_name: 'tools',
    zome_name: 'library',
    fn_name: 'create_tool',
    payload,
  });
  return new EntryRecord<Tool>(toolRecord);
}

function storeAppAssetsInfo(
  appletConfig: AppletConfig,
  appId: string,
  mossFileSystem: MossFileSystem,
  distributionInfo: DistributionInfo,
  happPath: string,
  happHash: string,
  maybeWebHappPath?: string,
  maybeWebHappHash?: string,
  maybeUiHash?: string,
) {
  // TODO potentially add distribution info from AppEntry that's being published earlier
  // to be able to simulate UI updates

  // Store app metadata
  const appAssetsInfo: AppAssetsInfo =
    appletConfig.source.type === 'localhost'
      ? {
          type: 'webhapp',
          assetSource: {
            type: 'https',
            url: `file://${happPath}`,
          },
          distributionInfo,
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
            assetSource: {
              type: 'https',
              url: `file://${maybeWebHappPath}`,
            },
            distributionInfo,
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
            assetSource: {
              type: 'https',
              url: `file://${happPath}`,
            },
            distributionInfo,
          };

  mossFileSystem.storeAppAssetsInfo(appId, appAssetsInfo);
}

function _arrayBufferToBase64(buffer) {
  var binary = '';
  var bytes = new Uint8Array(buffer);
  var len = bytes.byteLength;
  for (var i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

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
  changelog: string | undefined;
  editors: Array<AgentPubKey>;

  author: AgentPubKey;
  published_at: number;
  last_updated: number;
  deprecation?: {
    message: string;
    recommended_alternatives: any;
  };
}

export type Applet = {
  /**
   * ActionHash of the StewardPermission based on which the Applet entry has been created
   */
  permission_hash?: ActionHash;
  /**
   * name of the applet instance as chosen by the person adding it to the group
   */
  custom_name: string;
  description: string;
  sha256_happ: string;
  sha256_ui: string | undefined;
  sha256_webhapp: string | undefined;
  distribution_info: string;
  network_seed: string | undefined;
  properties: Record<string, Uint8Array>; // Segmented by RoleId
  meta_data?: string;
};

export interface WebAddress {
  url: string;
  context: string | undefined;
}

export interface LocationTriplet {
  country: string;
  region: string;
  city: string;
}

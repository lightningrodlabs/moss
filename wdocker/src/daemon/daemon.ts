#!/usr/bin/env node

/**
 * The daemon is responsible to run the holochain conductor and regularly poll for
 * new Tools in groups etc.
 */

// import * as childProcess from 'child_process';
import { Command } from 'commander';
import fetch from 'node-fetch';
import path from 'path';
import os from 'os';
import fs from 'fs';

import { startConductor } from './start.js';
import { WDockerFilesystem } from '../filesystem.js';
import { getAdminWsAndAppPort, getAppWs, getWeRustHandler } from '../helpers/helpers.js';
import {
  ALWAYS_ONLINE_TAG,
  GroupClient,
  PeerStatusClient,
  SignalPayloadPeerStatus,
} from '@theweave/group-client';
import {
  AdminWebsocket,
  AgentPubKey,
  decodeHashFromBase64,
  encodeHashToBase64,
  InstalledAppId,
} from '@holochain/client';
import { AppletHash, AppletId } from '@theweave/api';
import {
  AppHashes,
  DeveloperCollectiveToolList,
  DistributionInfo,
  TDistributionInfo,
  WebHappSource,
} from '@theweave/moss-types';
import { appIdFromAppletHash, getLatestVersionFromToolInfo } from '@theweave/utils';
import rustUtils, { WeRustHandler } from '@lightningrodlabs/we-rust-utils';
import { nanoid } from 'nanoid';
import { Value } from '@sinclair/typebox/value';

// let CONDUCTOR_HANDLE: childProcess.ChildProcessWithoutNullStreams | undefined;

const wdaemon = new Command();

wdaemon
  .name('wdaemon')
  .description(
    'Background daemon running a holochain conductor and polling for new apps to install.',
  )
  .argument('<id>', 'id of the conductor to run in the background.');

wdaemon.parse();

const CONDUCTOR_ID = wdaemon.args[0];

console.log(`Starting daemon for conductor '${CONDUCTOR_ID}'`);

const WDOCKER_FILE_SYSTEM = new WDockerFilesystem();
WDOCKER_FILE_SYSTEM.setConductorId(CONDUCTOR_ID);

const cleanExit = () => {
  console.log('CALLED TO EXIT!');
  WDOCKER_FILE_SYSTEM.clearRunningFile();
  WDOCKER_FILE_SYSTEM.clearRunningSecretFile();
  process.exit();
};
process.on('SIGINT', cleanExit); // catch Ctrl+C
process.on('SIGTERM', cleanExit); // catch kill

const PING_AGENTS_FREQUENCY_MS = 8000;

const GROUP_ALL_AGENTS: Record<InstalledAppId, AgentPubKey[]> = {};

let password;
process.stdin.resume();
process.stdin.on('data', (d) => {
  password = d.toString();
});

setTimeout(async () => {
  if (!password) return;
  // Start conductor and store RunningInfo to disk
  let runningConductorAndInfo;
  try {
    runningConductorAndInfo = await startConductor(CONDUCTOR_ID, password);
  } catch (e) {
    if (e === 'WRONG_PASSWORD') {
      console.error('\nWRONG PASSWORD.\n');
      return;
    }
    throw e;
  }
  if (!runningConductorAndInfo) {
    console.error('Failed to start conductor.');
    process.exit();
  }

  // CONDUCTOR_HANDLE = runningConductorAndInfo.conductorHandle;

  WDOCKER_FILE_SYSTEM.storeRunningFile({
    daemonPid: process.pid,
    ...runningConductorAndInfo.runningInfo,
  });
  WDOCKER_FILE_SYSTEM.storeRunningSecretFile(runningConductorAndInfo.runningSecretInfo, password);

  const weRustHandler = await getWeRustHandler(WDOCKER_FILE_SYSTEM, password);

  // This line is used by the parent process to return when run in detached mode.
  console.log('Daemon ready.');

  // // Some unused code to verify whether the daemon is still running
  // fs.writeFileSync(path.join(WDOCKER_FILE_SYSTEM.conductorDataDir, '._alive'), `${Date.now()}`);

  // setInterval(() => {
  //   fs.writeFileSync(path.join(WDOCKER_FILE_SYSTEM.conductorDataDir, '._alive'), `${Date.now()}`);
  // }, 2000);

  const { adminWs, appPort } = await getAdminWsAndAppPort(CONDUCTOR_ID, password);

  // Set up handler for remote signals and update agent profiles
  const allApps = await adminWs.listApps({});
  const groupApps = allApps.filter((appInfo) => appInfo.installed_app_id.startsWith('group#'));

  const tzOffset = new Date().getTimezoneOffset();
  // TODO wrap in try catch blocks
  for (const groupApp of groupApps) {
    const groupAppWs = await getAppWs(adminWs, appPort, groupApp.installed_app_id, weRustHandler);
    const peerStatusClient = new PeerStatusClient(groupAppWs, 'group');
    peerStatusClient.onSignal(async (signal: SignalPayloadPeerStatus) => {
      if (signal.type == 'Ping') {
        console.log('Received ping from ', encodeHashToBase64(signal.from_agent));
        await peerStatusClient.pong([signal.from_agent], 'online', tzOffset);
      }
    });
    const myPubkeySum = Array.from(groupAppWs.myPubKey).reduce((acc, curr) => acc + curr, 0);

    // Get all local agents first, then try getting them over the network
    const allAgents: AgentPubKey[] = await groupAppWs.callZome({
      role_name: 'group',
      zome_name: 'profiles',
      fn_name: 'get_agents_with_profile',
      payload: { input: null, local: true },
    });
    GROUP_ALL_AGENTS[groupApp.installed_app_id] = allAgents;
    try {
      const allAgents: AgentPubKey[] = await groupAppWs.callZome({
        role_name: 'group',
        zome_name: 'profiles',
        fn_name: 'get_agents_with_profile',
        payload: { input: null, local: false },
      });
      GROUP_ALL_AGENTS[groupApp.installed_app_id] = allAgents;
    } catch (e) {
      console.warn('WARN: Failed to get agents with profile via the network.');
    }
    setInterval(async () => {
      try {
        const allAgents: AgentPubKey[] = await groupAppWs.callZome({
          role_name: 'group',
          zome_name: 'profiles',
          fn_name: 'get_agents_with_profile',
          payload: { input: null, local: false },
        });
        GROUP_ALL_AGENTS[groupApp.installed_app_id] = allAgents;
      } catch (e) {
        console.warn('WARN: Failed to get agents with profile via the network.');
      }
    }, 300_000);
    // Ping all agents
    setInterval(async () => {
      const allAgents = GROUP_ALL_AGENTS[groupApp.installed_app_id];
      if (!allAgents) return;
      const agentsThatNeedPinging = allAgents.filter(
        (agent) =>
          encodeHashToBase64(agent) !== encodeHashToBase64(groupAppWs.myPubKey) &&
          needsPinging(agent, myPubkeySum),
      );
      // console.log(
      //   'Pinging agents: ',
      //   agentsThatNeedPinging.map((hash) => encodeHashToBase64(hash)),
      // );
      await peerStatusClient.ping(agentsThatNeedPinging, 'online', tzOffset);
    }, PING_AGENTS_FREQUENCY_MS);
  }

  // Every X minutes, check all installed groups and for each group fetch the default apps
  // group metadata as well as the unjoined tools and try to join the ones that should
  // be joined
  try {
    await checkForNewGroupsAndApplets(adminWs, appPort, weRustHandler);
  } catch (e) {
    console.error('Failed to check for new groups and tools: ', e);
  }

  setInterval(async () => {
    try {
      await checkForNewGroupsAndApplets(adminWs, appPort, weRustHandler);
    } catch (e) {
      console.error('Failed to check for new groups and tools: ', e);
    }
  }, WDOCKER_FILE_SYSTEM.wdockerConductorConfig.checkForGroupsAndToolsFrequencySeconds * 1000);
}, 1000);

async function checkForNewGroupsAndApplets(
  adminWs: AdminWebsocket,
  appPort: number,
  weRustHandler: WeRustHandler,
): Promise<void> {
  console.log(
    `\n\n************************************************\n${new Date()}\nChecking for new Groups and Tools`,
  );
  const allApps = await adminWs.listApps({});
  const groupApps = allApps.filter((appInfo) => appInfo.installed_app_id.startsWith('group#'));

  // Check for unjoined applets and try to install them
  for (const groupApp of groupApps) {
    try {
      const groupAppWs = await getAppWs(adminWs, appPort, groupApp.installed_app_id, weRustHandler);
      const groupClient = new GroupClient(groupAppWs, [], 'group');

      console.log('Checking for Tools to join in group ', groupApp.installed_app_id);
      const unjoinedDefaultApplets = await checkForUnjoinedAppletsToJoin(groupClient);
      if (unjoinedDefaultApplets.length === 0) {
        console.log('No new tools found.');
        continue;
      }

      for (const unjoinedApplet of unjoinedDefaultApplets) {
        console.log('Joining Tool', unjoinedApplet);
        try {
          await tryJoinApplet(decodeHashFromBase64(unjoinedApplet), adminWs, groupClient);
        } catch (e) {
          console.error('Failed to join Tool: ', e);
        }
        console.log('Tool Joined.');
      }

      // Check for unjoined cloned cells
      try {
        const allAppletHashes = await groupClient.getGroupApplets();
        for (const appletHash of allAppletHashes) {
          const unjoinedClonedCellEntryhashes =
            await groupClient.getUnjoinedClonedCellsForApplet(appletHash);
          for (const unjoinedCloneHash of unjoinedClonedCellEntryhashes) {
            console.log(
              'Joining cloned cell with entry hash',
              encodeHashToBase64(unjoinedCloneHash),
            );
            try {
              const appletClone = await groupClient.getAppletClonedCell(unjoinedCloneHash);
              if (appletClone) {
                const appletAppId = appIdFromAppletHash(appletHash);
                const appletAppWs = await getAppWs(adminWs, appPort, appletAppId, weRustHandler);
                await appletAppWs.createCloneCell({
                  role_name: appletClone.role_name,
                  modifiers: {
                    network_seed: appletClone.network_seed,
                    properties: appletClone.properties,
                  },
                });
              } else {
                console.warn(
                  `No AppletClonedCell entry found for the given hash (${encodeHashToBase64(unjoinedCloneHash)}).`,
                );
              }
            } catch (e) {
              console.error(
                `Failed to create clone cell for applet with hash ${encodeHashToBase64(appletHash)} and AppletClonedCell with hash ${encodeHashToBase64(unjoinedCloneHash)}`,
              );
            }
          }
        }
      } catch (e) {
        console.error(
          `Failed to check for unjoined cloned cells in group with app id ${groupApp.installed_app_id}`,
        );
      }
    } catch (e) {
      console.error('Failed to check for Tools in group ', groupApp.installed_app_id);
    }
  }
}

async function checkForUnjoinedAppletsToJoin(groupClient: GroupClient): Promise<AppletId[]> {
  const groupAppletsMetadata = await groupClient.getGroupAppletsMetaData();
  if (!groupAppletsMetadata) return [];
  const appletsToJoinByAlwaysOnlinNodes = Object.entries(groupAppletsMetadata)
    .filter(([_appletId, metaData]) => metaData.tags.includes(ALWAYS_ONLINE_TAG))
    .map(([appletId, _]) => appletId);

  const unjoinedApplets = await groupClient.getUnjoinedApplets();
  const unjoinedAppletIds = unjoinedApplets.map(([appletHash, _addedByAgent, _addedTime]) =>
    encodeHashToBase64(appletHash),
  );
  const unjoinedAppletsToJoin = unjoinedAppletIds.filter((appletId) =>
    appletsToJoinByAlwaysOnlinNodes.includes(appletId),
  );
  if (unjoinedAppletsToJoin.length === 0) {
    console.log('No unjoined default Tools found.');
    return [];
  }
  console.log('Found unjoined Tools to join by always-online nodes: ', unjoinedAppletsToJoin);
  return unjoinedAppletsToJoin;
}

async function tryJoinApplet(
  appletHash: AppletHash,
  adminWs: AdminWebsocket,
  groupClient: GroupClient,
): Promise<void> {
  // 1. Get Applet entry from group DHT
  const applet = await groupClient.getApplet(appletHash);
  if (!applet) throw new Error('Applet entry not found. Cannot join Tool.');
  if (!applet.network_seed)
    throw new Error(
      'Network Seed not defined. Undefined network seed is currently not supported. Joining Tool aborted.',
    );

  // 2. Fetch from the web2 Tool list
  const distributionInfo: DistributionInfo = JSON.parse(applet.distribution_info);
  Value.Assert(TDistributionInfo, distributionInfo);

  if (distributionInfo.type !== 'web2-tool-list')
    throw new Error(
      `Only distribution info 'web2-tool-list' is supported but got ${distributionInfo.type}`,
    );

  const resp = await fetch(distributionInfo.info.toolListUrl);
  const toolList = (await resp.json()) as DeveloperCollectiveToolList;
  const toolInfo = toolList.tools.find(
    (tool) =>
      tool.id === distributionInfo.info.toolId &&
      tool.versionBranch === distributionInfo.info.versionBranch,
  );

  if (!toolInfo) throw new Error('No Tool info found in Tool list.');

  const latestVersion = getLatestVersionFromToolInfo(toolInfo, applet.sha256_happ);
  if (!latestVersion) {
    console.warn(
      'No latest version found for Tool with id ',
      toolInfo.id,
      'at URL ',
      distributionInfo.info.toolListUrl,
    );
    return;
  }

  const appHashes: AppHashes = {
    type: 'webhapp',
    sha256: latestVersion.hashes.webhappSha256, // The sha256 of the happ needs to match the one in the AppletEntry
    happ: {
      sha256: applet.sha256_happ,
    },
    ui: {
      sha256: latestVersion.hashes.uiSha256,
    },
  };

  // 3. Fetch the happ bytes if necessary
  await fetchAndStoreHappIfNecessary(
    {
      type: 'https',
      url: latestVersion.url,
    },
    appHashes,
    WDOCKER_FILE_SYSTEM.happsDir,
  );

  // 4. Install the happ in the conductor and join the Applet in the group DHT
  const appId = appIdFromAppletHash(appletHash);

  // Check that app with same id is not already installed
  // This is to ensure that we can safely uninstall the app again in case of failure
  // (On failure case is that an app with the same id is already installed, in which case
  // we should NOT uninstall it)
  const installedApps = await adminWs.listApps({});
  if (installedApps.find((appInfo) => appInfo.installed_app_id === appId))
    throw new Error('App with the same app id is already installed.');

  const appInfo = await adminWs.installApp({
    source: {
      type: 'path',
      value: WDOCKER_FILE_SYSTEM.happFilePath(appHashes.happ.sha256),
    },
    installed_app_id: appId,
    agent_key: groupClient.appClient.myPubKey,
    network_seed: applet.network_seed,
  });

  try {
    await adminWs.enableApp({ installed_app_id: appId });
  } catch (e) {
    console.warn(
      `Failed to enable app ${appId} (might have deferred_memproof_provisioning set to true in which case this is expected):`,
      e,
    );
  }

  try {
    const joinAppletInput = {
      applet,
      joining_pubkey: appInfo.agent_pub_key,
    };
    await groupClient.joinApplet(joinAppletInput);
  } catch (e) {
    console.error(
      `Failed to join applet in group dna after installation: ${e}\nUninstalling again.`,
    );
    try {
      await adminWs.uninstallApp({ installed_app_id: appId });
    } catch (err) {
      console.error(
        `Failed to uninstall applet after joining of applet in group dna failed: ${err}`,
      );
    }
  }
}

async function fetchAndStoreHappIfNecessary(
  source: WebHappSource,
  appHashes: AppHashes & { type: 'webhapp' },
  happsDir: string,
): Promise<void> {
  const isAlreadyAvailable = WDOCKER_FILE_SYSTEM.isHappAvailableAndValid(appHashes.happ.sha256);
  if (isAlreadyAvailable) return undefined;

  const response = await fetch(source.url);
  const buffer = await response.arrayBuffer();
  const assetBytes = Array.from(new Uint8Array(buffer));
  const { happSha256 } = await rustUtils.validateHappOrWebhapp(assetBytes);

  if (happSha256 !== appHashes.happ.sha256)
    throw new Error(
      `The sha256 of the fetched webhapp does not match the expected sha256. Expected ${appHashes.happ.sha256} but got ${happSha256}`,
    );

  // TODO Store happ bytes on disk

  const tmpDir = path.join(os.tmpdir(), `moss-applet-${nanoid(8)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const webHappPath = path.join(tmpDir, 'applet_to_install.webhapp');
  fs.writeFileSync(webHappPath, new Uint8Array(buffer));
  await rustUtils.saveHappOrWebhapp(webHappPath, happsDir, undefined);
  try {
    fs.rmSync(tmpDir, { recursive: true });
  } catch (e) {}
}

function needsPinging(agent: AgentPubKey, myPubkeySum: number): boolean {
  const pubkeySum = Array.from(agent).reduce((acc, curr) => acc + curr, 0);
  const diff = pubkeySum - myPubkeySum;
  if (diff % 2 === 0) {
    if (diff === 0) return true;
    return myPubkeySum > pubkeySum;
  } else {
    return myPubkeySum < pubkeySum;
  }
}

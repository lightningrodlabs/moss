#!/usr/bin/env node

/**
 * The daemon is responsible to run the holochain conductor and regularly poll for
 * new Tools in groups etc.
 */

// import * as childProcess from 'child_process';
import { Command } from 'commander';

import { startConductor } from './start.js';
import { WDockerFilesystem } from '../filesystem.js';
import { getAdminWs } from '../helpers/helpers.js';
import { installDefaultAppsIfNecessary } from './installDefaultApps.js';
import { GroupClient } from '../../../shared/group-client/dist/index.js';
import {
  AdminWebsocket,
  AppWebsocket,
  CallZomeTransform,
  encodeHashToBase64,
  InstalledAppId,
} from '@holochain/client';
import rustUtils from '@lightningrodlabs/we-rust-utils';
import { signZomeCall } from '../utils.js';
import { decode } from '@msgpack/msgpack';
import { AppletHash } from '@theweave/api';

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
  WDOCKER_FILE_SYSTEM.clearRunningFile();
  WDOCKER_FILE_SYSTEM.clearRunningSecretFile();
  process.exit();
};
process.on('SIGINT', cleanExit); // catch Ctrl+C
process.on('SIGTERM', cleanExit); // catch kill

let password;
process.stdin.resume();
process.stdin.on('data', (d) => {
  password = d.toString();
});

setTimeout(async () => {
  if (!password) return;
  // Start conductor and store RunningInfo to disk
  const runningConductorAndInfo = await startConductor(CONDUCTOR_ID, password);
  if (!runningConductorAndInfo) process.exit();

  // CONDUCTOR_HANDLE = runningConductorAndInfo.conductorHandle;

  WDOCKER_FILE_SYSTEM.storeRunningFile({
    daemonPid: process.pid,
    ...runningConductorAndInfo.runningInfo,
  });
  WDOCKER_FILE_SYSTEM.storeRunningSecretFile(runningConductorAndInfo.runningSecretInfo, password);

  // Install default apps if necessary
  const adminWs = await getAdminWs(CONDUCTOR_ID, password);
  await installDefaultAppsIfNecessary(adminWs);

  // Get or attach app interface
  const appInterfaces = await adminWs.listAppInterfaces();
  let appPort: number;
  if (appInterfaces.length > 0) {
    appPort = appInterfaces[0].port;
  } else {
    const attachAppInterfaceResponse = await adminWs.attachAppInterface({
      allowed_origins: 'wdocker',
    });
    console.log('Attached app interface port: ', attachAppInterfaceResponse);
    appPort = attachAppInterfaceResponse.port;
  }

  const lairUrl = WDOCKER_FILE_SYSTEM.readLairUrl();
  if (!lairUrl) throw new Error('Failed to read lair connection url');
  const weRustHandler = await rustUtils.WeRustHandler.connect(lairUrl, password);

  // Every X minutes, check all installed groups and for each group fetch the default apps
  // group metadata as well as the unjoined tools and try to join the ones that should
  // be joined

  const allApps = await adminWs.listApps({});
  const groupApps = allApps.filter((appInfo) => appInfo.installed_app_id.startsWith('group#'));

  for (const groupApp of groupApps) {
    console.log('Checking for tools to join for group ', groupApp.installed_app_id);
    const appWs = await getAppWebsocket(adminWs, appPort, groupApp.installed_app_id, weRustHandler);
    const groupClient = new GroupClient(appWs, [], 'group');
    const defaultGroupApplets = await groupClient.getGroupDefaultApplets();
    if (!defaultGroupApplets) break;
    const unjoinedApplets = await groupClient.getUnjoinedApplets();
    const unjoinedAppletIds = unjoinedApplets.map(([appletHash, _addedByAgent, _addedTime]) =>
      encodeHashToBase64(appletHash),
    );
    const unjoinedDefaultApplets = unjoinedAppletIds.filter((appletId) =>
      defaultGroupApplets.includes(appletId),
    );
    if (unjoinedDefaultApplets.length === 0) {
      console.log('No unjoined default Tools found.');
      break;
    }
    console.log('Found unjoined default Tools: ', unjoinedDefaultApplets);
    for (const unjoinedApplet of unjoinedDefaultApplets) {
      console.log('Joining Tool', unjoinedApplet);
    }
  }
}, 1000);

async function getAppWebsocket(
  adminWs: AdminWebsocket,
  appPort: number,
  installedAppId: InstalledAppId,
  weRustHandler: rustUtils.WeRustHandler,
): Promise<AppWebsocket> {
  const authTokenResponse = await adminWs.issueAppAuthenticationToken({
    installed_app_id: installedAppId,
    expiry_seconds: 10,
    single_use: true,
  });
  const callZomeTransform: CallZomeTransform = {
    input: (req) => signZomeCall(req, weRustHandler),
    output: (o) => decode(o as any),
  };
  return AppWebsocket.connect({
    url: new URL(`ws://localhost:${appPort}`),
    token: authTokenResponse.token,
    callZomeTransform,
    wsClientOptions: {
      origin: 'wdocker',
    },
  });
}

// async function joinApplet(appletHash: AppletHash, groupClient: GroupClient): Promise<void> {
//   // 1. Get Applet entry
//   const applet = await groupClient.getApplet(appletHash);
//   if (!applet) throw new Error('Applet entry not found');

//   // 2.

//   const appInfo = await this.mossStore.installApplet(appletHash, applet);
//   const joinAppletInput = {
//     applet,
//     joining_pubkey: appInfo.agent_pub_key,
//   };
//   try {
//     await groupClient.joinApplet(joinAppletInput);
//   } catch (e) {
//     console.error(
//       `Failed to join applet in group dna after installation: ${e}\nUninstalling again.`,
//     );
//     try {
//       await this.mossStore.uninstallApplet(appletHash);
//     } catch (err) {
//       console.error(
//         `Failed to uninstall applet after joining of applet in group dna failed: ${err}`,
//       );
//     }
//   }
// }

// const appId = appIdFromAppletHash(appletHash);
// if (!applet.network_seed) {
//   throw new Error(
//     'Network Seed not defined. Undefined network seed is currently not supported.',
//   );
// }

// const toolEntity = await this.toolsLibraryStore.getLatestToolEntry(
//   toolBundleActionHashFromDistInfo(applet.distribution_info),
// );

// console.log('@installApplet: got ToolEntry: ', toolEntity.record.entry);
// console.log('@installApplet: got Applet: ', applet);

// if (!toolEntity) throw new Error('ToolEntry not found in Tools Library');

// const source: WebHappSource = JSON.parse(toolEntity.record.entry.source);
// if (source.type !== 'https') throw new Error(`Unsupported applet source type '${source.type}'`);
// if (!(source.url.startsWith('https://') || source.url.startsWith('file://')))
//   throw new Error(`Invalid applet source URL '${source.url}'`);

// const appHashes: AppHashes = JSON.parse(toolEntity.record.entry.hashes);
// if (appHashes.type !== 'webhapp')
//   throw new Error(`Got invalid AppHashes type: ${appHashes.type}`);

// const distributionInfo: DistributionInfo = JSON.parse(applet.distribution_info);

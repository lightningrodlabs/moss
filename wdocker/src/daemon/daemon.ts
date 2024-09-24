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
import { GroupClient } from '@theweave/group-client';
import { AdminWebsocket, AppWebsocket, CallZomeTransform, InstalledAppId } from '@holochain/client';
import rustUtils from '@lightningrodlabs/we-rust-utils';
import { signZomeCall } from '../utils.js';
import { decode } from '@msgpack/msgpack';

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

  // Every X minutes, check all installed groups and for each group fetch unjoined tools and try to join

  const allApps = await adminWs.listApps({});
  const groupApps = allApps.filter((appInfo) => appInfo.installed_app_id.startsWith('group#'));

  for (const groupApp of groupApps) {
    const appWs = await getAppWebsocket(adminWs, appPort, groupApp.installed_app_id, weRustHandler);
    const groupClient = new GroupClient(appWs, [], 'group');
    const unjoinedTools = await groupClient.getUnjoinedApplets();
    console.log('unjoined tools of group', groupApp.installed_app_id, ': ', unjoinedTools);
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

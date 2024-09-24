#!/usr/bin/env node

/**
 * The daemon is responsible to run the holochain conductor and regularly poll for
 * new Tools in groups etc.
 */

// import * as childProcess from 'child_process';
import { Command } from 'commander';

import { startConductor } from './start.js';
import { WDockerFilesystem } from '../filesystem.js';

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

  // TODO connect to the admin websocket and do all the installation and scheduling logic

  // Every X minutes, check all installed groups and for each group fetch unjoined tools and try to join
}, 1000);

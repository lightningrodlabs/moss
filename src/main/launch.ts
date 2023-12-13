import * as childProcess from 'child_process';
import path from 'path';
import { BrowserWindow } from 'electron';
import { WeFileSystem } from './filesystem';
import { initializeLairKeystore, launchLairKeystore } from './lairKeystore';
import { LauncherEmitter } from './launcherEmitter';
import { APPSTORE_APP_ID } from './sharedTypes';
import { DEFAULT_APPS_DIRECTORY } from './paths';
import { APPSTORE_NETWORK_SEED, BOOTSTRAP_URL, SIGNALING_URL, WE_APPLET_DEV_INFO } from '.';
import { HOLOCHAIN_BINARIES, LAIR_BINARY } from './binaries';
import { HolochainManager } from './holochainManager';
import { devSetup } from './devSetup';
import { WeRustHandler } from 'hc-we-rust-utils';

const rustUtils = require('hc-we-rust-utils');

export async function launch(
  weFileSystem: WeFileSystem,
  launcherEmitter: LauncherEmitter,
  splashscreenWindow: BrowserWindow | undefined,
  password: string,
): Promise<[childProcess.ChildProcessWithoutNullStreams, HolochainManager, WeRustHandler]> {
  console.log('LAIR BINARY PATH: ', LAIR_BINARY);
  // Initialize lair if necessary
  const lairHandleTemp = childProcess.spawnSync(LAIR_BINARY, ['--version']);
  if (!lairHandleTemp.stdout) {
    console.error(`Failed to run lair-keystore binary:\n${JSON.stringify(lairHandleTemp)}`);
  }
  console.log(`Got lair version ${lairHandleTemp.stdout.toString()}`);
  if (!weFileSystem.keystoreInitialized()) {
    if (splashscreenWindow)
      splashscreenWindow.webContents.send('loading-progress-update', 'Starting lair keystore...');
    // TODO: https://github.com/holochain/launcher/issues/144
    // const lairHandle = childProcess.spawn(lairBinary, ["init", "-p"], { cwd: WE_FILE_SYSTEM.keystoreDir });
    // lairHandle.stdin.write(password);
    // lairHandle.stdin.end();
    // lairHandle.stdout.pipe(split()).on("data", (line: string) => {
    //   console.log("[LAIR INIT]: ", line);
    // })
    await initializeLairKeystore(LAIR_BINARY, weFileSystem.keystoreDir, launcherEmitter, password);
  }
  if (splashscreenWindow)
    splashscreenWindow.webContents.send('loading-progress-update', 'Starting lair keystore...');

  // launch lair keystore
  const [lairHandle, lairUrl] = await launchLairKeystore(
    LAIR_BINARY,
    weFileSystem.keystoreDir,
    launcherEmitter,
    password,
  );

  const holochainVersion = 'holochain-v0.2.4-rc.0';

  if (splashscreenWindow)
    splashscreenWindow.webContents.send(
      'loading-progress-update',
      `Starting ${holochainVersion}...`,
    );

  // launch holochain
  const holochainManager = await HolochainManager.launch(
    launcherEmitter,
    weFileSystem,
    HOLOCHAIN_BINARIES[holochainVersion],
    password,
    holochainVersion,
    weFileSystem.conductorDir,
    weFileSystem.conductorConfigPath,
    lairUrl,
    BOOTSTRAP_URL,
    SIGNALING_URL,
  );
  // ADMIN_PORT = holochainManager.adminPort;
  // ADMIN_WEBSOCKET = holochainManager.adminWebsocket;
  // APP_PORT = holochainManager.appPort;cd di

  const weRustHandler: WeRustHandler = await rustUtils.WeRustHandler.connect(
    lairUrl,
    holochainManager.adminPort,
    holochainManager.appPort,
    password,
  );

  // Install default apps if necessary:
  if (
    !holochainManager.installedApps
      .map((appInfo) => appInfo.installed_app_id)
      .includes(APPSTORE_APP_ID)
  ) {
    console.log('Installing AppStore...');
    if (splashscreenWindow)
      splashscreenWindow.webContents.send('loading-progress-update', 'Installing AppStore...');
    await holochainManager.installApp(
      path.join(DEFAULT_APPS_DIRECTORY, 'AppstoreLight.happ'),
      APPSTORE_APP_ID,
      APPSTORE_NETWORK_SEED,
    );
    console.log('AppstoreLight installed.');
  }
  if (WE_APPLET_DEV_INFO) {
    await devSetup(WE_APPLET_DEV_INFO, holochainManager, weFileSystem);
  }
  return [lairHandle, holochainManager, weRustHandler];
}

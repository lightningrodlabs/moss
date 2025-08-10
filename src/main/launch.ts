import * as childProcess from 'child_process';
import fs from 'fs';
import path from 'path';
import { BrowserWindow } from 'electron';
import { MossFileSystem } from './filesystem';
import { initializeLairKeystore, launchLairKeystore } from './lairKeystore';
import { DistributionInfo } from '@theweave/moss-types';
import { DEFAULT_APPS_DIRECTORY } from './paths';
import { HOLOCHAIN_BINARIES, LAIR_BINARY } from './const';
import { HolochainManager } from './holochainManager';
import { devSetup } from './cli/devSetup';
import { RunOptions } from './cli/cli';
import { WeEmitter } from './weEmitter';
import { MOSS_CONFIG } from './mossConfig';
import { type WeRustHandler } from '@lightningrodlabs/we-rust-utils';
const rustUtils = require('@lightningrodlabs/we-rust-utils');

const DEFAULT_APPS: Record<string, string> = {};

export async function launch(
  mossFileSystem: MossFileSystem,
  weEmitter: WeEmitter,
  splashscreenWindow: BrowserWindow | undefined,
  password: string,
  runOptions: RunOptions,
  customBinary?: string,
): Promise<[childProcess.ChildProcessWithoutNullStreams, HolochainManager, WeRustHandler]> {
  console.log('LAIR BINARY PATH: ', LAIR_BINARY);
  // Initialize lair if necessary
  const lairHandleTemp = childProcess.spawnSync(LAIR_BINARY, ['--version']);
  if (!lairHandleTemp.stdout) {
    console.error(`Failed to run lair-keystore binary:\n${JSON.stringify(lairHandleTemp)}`);
  }
  console.log(`Got lair version ${lairHandleTemp.stdout.toString()}`);
  if (!mossFileSystem.keystoreInitialized()) {
    if (splashscreenWindow)
      splashscreenWindow.webContents.send(
        'loading-progress-update',
        'Initializing lair keystore...',
      );
    try {
      await initializeLairKeystore(LAIR_BINARY, mossFileSystem.keystoreDir, weEmitter, password);
    } catch (e) {
      weEmitter.emitMossError(`Failed to initialize lair keystore: ${e}`);
      throw new Error(`Failed to initialize lair keystore: ${e}`);
    }
  }
  if (splashscreenWindow)
    splashscreenWindow.webContents.send('loading-progress-update', 'Starting lair keystore...');

  // launch lair keystore
  let lairHandle: childProcess.ChildProcessWithoutNullStreams;
  let lairUrl: string;
  try {
    [lairHandle, lairUrl] = await launchLairKeystore(
      LAIR_BINARY,
      mossFileSystem.keystoreDir,
      weEmitter,
      password,
      runOptions.lairRustLog,
    );
  } catch (e) {
    weEmitter.emitMossError(`Failed to launch lair keystore: ${e}`);
    throw new Error(`Failed to launch lair keystore: ${e}`);
  }

  const holochainVersion = MOSS_CONFIG.holochain.version;

  if (splashscreenWindow)
    splashscreenWindow.webContents.send(
      'loading-progress-update',
      `Starting Holochain ${holochainVersion}...`,
    );

  // launch holochain
  let holochainManager: HolochainManager;
  try {
    holochainManager = await HolochainManager.launch(
      weEmitter,
      mossFileSystem,
      customBinary ? customBinary : HOLOCHAIN_BINARIES[holochainVersion],
      password,
      holochainVersion,
      mossFileSystem.conductorDir,
      mossFileSystem.conductorConfigPath,
      lairUrl,
      runOptions.bootstrapUrl!,
      runOptions.signalingUrl!,
      runOptions.iceUrls,
      runOptions.holochainRustLog,
      runOptions.holochainWasmLog,
    );
  } catch (e) {
    weEmitter.emitMossError(`Failed to launch HolochainManager: ${e}`);
    throw new Error(`Failed to launch HolochainManager: ${e}`);
  }
  // ADMIN_PORT = holochainManager.adminPort;
  // ADMIN_WEBSOCKET = holochainManager.adminWebsocket;
  // APP_PORT = holochainManager.appPort;cd di

  let weRustHandler: WeRustHandler;
  try {
    weRustHandler = await rustUtils.WeRustHandler.connect(lairUrl, password);
  } catch (e) {
    weEmitter.emitMossError(`Failed to connect to WeRustHandler: ${e}`);
    throw new Error(`Failed to connect to WeRustHandler: ${e}`);
  }

  // // Install default appstore if necessary:
  // if (
  //   !holochainManager.installedApps
  //     .map((appInfo) => appInfo.installed_app_id)
  //     .includes(TOOLS_LIBRARY_APP_ID)
  // ) {
  //   console.log('Installing Tools Library...');
  //   if (splashscreenWindow)
  //     splashscreenWindow.webContents.send('loading-progress-update', 'Installing Tools Library...');
  //   await holochainManager.installApp(
  //     path.join(DEFAULT_APPS_DIRECTORY, 'tools-library.happ'),
  //     TOOLS_LIBRARY_APP_ID,
  //     runOptions.appstoreNetworkSeed,
  //   );

  //   console.log('Tools Library installed.');
  // }
  // Install other default apps if necessary (not in applet-dev mode)
  if (!runOptions.devInfo) {
    await Promise.all(
      Object.entries(DEFAULT_APPS).map(async ([appName, fileName]) => {
        const appId = `default-app#${appName.toLowerCase()}`; // convert to lowercase to be able to use it in custom protocol
        if (
          !holochainManager.installedApps.map((appInfo) => appInfo.installed_app_id).includes(appId)
        ) {
          console.log(`Installing default app ${appName}`);
          if (splashscreenWindow)
            splashscreenWindow.webContents.send(
              'loading-progress-update',
              `Installing default app ${appName}...`,
            );

          const distributionInfo: DistributionInfo = {
            type: 'default-app',
          };
          await holochainManager.installWebApp(
            path.join(DEFAULT_APPS_DIRECTORY, fileName),
            appId,
            distributionInfo,
            runOptions.appstoreNetworkSeed,
          );
          console.log(`Default app ${appName} installed.`);
        } else {
          // Compare the hashes to check whether happ and/or UI got an update
          const currentAppAssetsInfo = mossFileSystem.readAppAssetsInfo(appId);
          if (
            currentAppAssetsInfo.type === 'webhapp' &&
            currentAppAssetsInfo.ui.location.type === 'filesystem'
          ) {
            const webHappPath = path.join(DEFAULT_APPS_DIRECTORY, fileName);
            const webHappBytes = fs.readFileSync(webHappPath);
            const { happSha256, webhappSha256, uiSha256 } = await rustUtils.validateHappOrWebhapp(
              Array.from(webHappBytes),
            );
            console.log('READ uiHash: ', uiSha256);
            if (happSha256 !== currentAppAssetsInfo.happ.sha256) {
              // In case that the previous happ sha256 is not the one of KanDo 0.9.1, replace it fully
              // const sha256Happ_0_9_1 =
              //   'e0b9ce4f16b632b436b888373981e1023762b59cc3cc646d76aed36bb7b565ed';
              // if (currentAppAssetsInfo.happ.sha256 !== sha256Happ_0_9_1) {
              // console.warn(
              //   'Found old KanDo feedback board. Uninstalling it and replacing it with a new version',
              // );
              // console.log(
              //   `Old happ hash: ${currentAppAssetsInfo.happ.sha256}. New happ hash: ${happHash}`,
              // );
              // if (splashscreenWindow)
              //   splashscreenWindow.webContents.send(
              //     'loading-progress-update',
              //     'Replacing feedback board with new version...',
              //   );
              // await holochainManager.adminWebsocket.uninstallApp({ installed_app_id: appId });
              // // back up previous assets info
              // mossFileSystem.backupAppAssetsInfo(appId);
              // const networkSeed = defaultAppNetworkSeed();
              // const distributionInfo: DistributionInfo = {
              //   type: 'default-app',
              // };
              // // Install new app
              // await holochainManager.installWebApp(
              //   path.join(DEFAULT_APPS_DIRECTORY, fileName),
              //   appId,
              //   distributionInfo,
              //   networkSeed,
              // );
              // return;
              // } else {
              console.warn(
                'Got new default app with the same name but a different happ hash. Aborted UI update process.',
              );
              return;
              // }
            }
            if (uiSha256 && uiSha256 !== currentAppAssetsInfo.ui.location.sha256) {
              // TODO emit this to the logs
              console.log(`Found new UI for default app '${appId}'. Installing.`);
              const newAppAssetsInfo = currentAppAssetsInfo;
              newAppAssetsInfo.sha256 = webhappSha256;
              (newAppAssetsInfo.ui.location as { type: 'filesystem'; sha256: string }).sha256 =
                uiSha256;
              await rustUtils.saveHappOrWebhapp(
                webHappPath,
                mossFileSystem.happsDir,
                mossFileSystem.uisDir,
              );
              mossFileSystem.backupAppAssetsInfo(appId);
              mossFileSystem.storeAppAssetsInfo(appId, newAppAssetsInfo);
            }
          }
        }
      }),
    );
  } else {
    await devSetup(runOptions.devInfo, holochainManager, mossFileSystem, false);
  }
  return [lairHandle, holochainManager, weRustHandler];
}

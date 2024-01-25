import * as childProcess from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { app, BrowserWindow } from 'electron';
import { DistributionInfo, WeFileSystem, breakingAppVersion } from './filesystem';
import { initializeLairKeystore, launchLairKeystore } from './lairKeystore';
import { APPSTORE_APP_ID } from './sharedTypes';
import { DEFAULT_APPS_DIRECTORY } from './paths';
import { HOLOCHAIN_BINARIES, LAIR_BINARY } from './binaries';
import { HolochainManager } from './holochainManager';
import { devSetup } from './devSetup';
import { WeRustHandler } from 'hc-we-rust-utils';
import { WeAppletDevInfo } from './cli';
import { WeEmitter } from './weEmitter';

const rustUtils = require('hc-we-rust-utils');

const DEFAULT_APPS = {
  'feedback-board': 'kando.webhapp',
};

export async function launch(
  weFileSystem: WeFileSystem,
  weEmitter: WeEmitter,
  splashscreenWindow: BrowserWindow | undefined,
  password: string,
  bootstrapUrl: string,
  singalingUrl: string,
  appstoreNetworkSeed: string,
  weAppletDevInfo: WeAppletDevInfo | undefined,
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
    await initializeLairKeystore(LAIR_BINARY, weFileSystem.keystoreDir, weEmitter, password);
  }
  if (splashscreenWindow)
    splashscreenWindow.webContents.send('loading-progress-update', 'Starting lair keystore...');

  // launch lair keystore
  const [lairHandle, lairUrl] = await launchLairKeystore(
    LAIR_BINARY,
    weFileSystem.keystoreDir,
    weEmitter,
    password,
  );

  const holochainVersion = 'holochain-v0.2.5-rc.0';

  if (splashscreenWindow)
    splashscreenWindow.webContents.send(
      'loading-progress-update',
      `Starting ${holochainVersion}...`,
    );

  // launch holochain
  const holochainManager = await HolochainManager.launch(
    weEmitter,
    weFileSystem,
    HOLOCHAIN_BINARIES[holochainVersion],
    password,
    holochainVersion,
    weFileSystem.conductorDir,
    weFileSystem.conductorConfigPath,
    lairUrl,
    bootstrapUrl,
    singalingUrl,
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

  // Install default appstore if necessary:
  if (
    !holochainManager.installedApps
      .map((appInfo) => appInfo.installed_app_id)
      .includes(APPSTORE_APP_ID)
  ) {
    console.log('Installing AppStore...');
    if (splashscreenWindow)
      splashscreenWindow.webContents.send('loading-progress-update', 'Installing App Library...');
    await holochainManager.installApp(
      path.join(DEFAULT_APPS_DIRECTORY, 'AppstoreLight.happ'),
      APPSTORE_APP_ID,
      appstoreNetworkSeed,
    );

    console.log('AppstoreLight installed.');
  }
  // Install other default apps if necessary (not in applet-dev mode)
  if (!weAppletDevInfo) {
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
          const networkSeed = !app.isPackaged
            ? `lightningrodlabs-we-applet-dev-${os.hostname()}`
            : `lightningrodlabs-we-${breakingAppVersion(app)}`;

          const distributionInfo: DistributionInfo = {
            type: 'default-app',
          };
          console.log('networkSeed: ', networkSeed);
          await holochainManager.installWebApp(
            path.join(DEFAULT_APPS_DIRECTORY, fileName),
            appId,
            distributionInfo,
            networkSeed,
          );
          console.log(`Default app ${appName} installed.`);
        } else {
          // Compare the hashes to check whether happ and/or UI got an update
          const currentAppAssetsInfo = weFileSystem.readAppAssetsInfo(appId);
          if (
            currentAppAssetsInfo.type === 'webhapp' &&
            currentAppAssetsInfo.ui.location.type === 'filesystem'
          ) {
            const webHappPath = path.join(DEFAULT_APPS_DIRECTORY, fileName);
            const webHappBytes = fs.readFileSync(webHappPath);
            const hashResult = await rustUtils.validateHappOrWebhapp(Array.from(webHappBytes));
            const [happHash, uiHash, webHappHash] = hashResult.split('$');
            console.log('READ uiHash: ', uiHash);
            if (happHash !== currentAppAssetsInfo.happ.sha256) {
              // In case that the previous happ sha256 is the one of KanDo 0.6.3, replace it fully
              const sha256Happ064 =
                '3c0ed7810919f0fb755116e37d27e995517e87f89225385ed797f22d8ca221d2';
              if (currentAppAssetsInfo.happ.sha256 === sha256Happ064) {
                console.warn(
                  'Found KanDo feedback board version 0.6.x. Uninstalling it and replacing it with 0.7.x.',
                );
                console.log(
                  `Old happ hash: ${currentAppAssetsInfo.happ.sha256}. New happ hash: ${happHash}`,
                );
                if (splashscreenWindow)
                  splashscreenWindow.webContents.send(
                    'loading-progress-update',
                    'Replacing feedback board with new version...',
                  );
                await holochainManager.adminWebsocket.uninstallApp({ installed_app_id: appId });
                // back up previous assets info
                weFileSystem.backupAppAssetsInfo(appId);
                const networkSeed = !app.isPackaged
                  ? `lightningrodlabs-we-applet-dev-${os.hostname()}`
                  : `lightningrodlabs-we-${breakingAppVersion(app)}`;

                const distributionInfo: DistributionInfo = {
                  type: 'default-app',
                };
                // Install new app
                await holochainManager.installWebApp(
                  path.join(DEFAULT_APPS_DIRECTORY, fileName),
                  appId,
                  distributionInfo,
                  networkSeed,
                );
                return;
              } else {
                console.warn(
                  'Got new default app with the same name but a different happ hash. Aborted UI update process.',
                );
                return;
              }
            }
            if (uiHash && uiHash !== currentAppAssetsInfo.ui.location.sha256) {
              // TODO emit this to the logs
              console.log(`Found new UI for default app '${appId}'. Installing.`);
              const newAppAssetsInfo = currentAppAssetsInfo;
              newAppAssetsInfo.sha256 = webHappHash;
              (newAppAssetsInfo.ui.location as { type: 'filesystem'; sha256: string }).sha256 =
                uiHash;
              await rustUtils.saveHappOrWebhapp(
                webHappPath,
                weFileSystem.uisDir,
                weFileSystem.happsDir,
              );
              weFileSystem.backupAppAssetsInfo(appId);
              weFileSystem.storeAppAssetsInfo(appId, newAppAssetsInfo);
            }
          }
        }
      }),
    );
  } else {
    await devSetup(weAppletDevInfo, holochainManager, weFileSystem);
  }
  return [lairHandle, holochainManager, weRustHandler];
}

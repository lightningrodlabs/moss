import * as childProcess from 'child_process';
import fs from 'fs';
import path from 'path';
import { BrowserWindow, app } from 'electron';
import { MossFileSystem } from './filesystem';
import { initializeLairKeystore, launchLairKeystore } from './lairKeystore';
import { DistributionInfo } from '@theweave/moss-types';
import { DEFAULT_APPS_DIRECTORY } from './paths';
import { HOLOCHAIN_BINARY, HOLOCHAIN_BINARY_VERSION, LAIR_BINARY } from './const';
import { HolochainManager } from './holochainManager';
import { devSetup } from './cli/devSetup';
import { RunOptions } from './cli/cli';
import { WeEmitter } from './weEmitter';
import { MOSS_CONFIG } from './mossConfig';
import { type WeRustHandler } from '@lightningrodlabs/we-rust-utils';
import {
  ChildName,
  ChildRecord,
  ChildRegistry,
  Leftover,
  killLeftovers,
  writeChildRegistry,
} from './childProcessRegistry';
import { systemProbe } from './processProbe';
import { ParentWatchdog, spawnParentWatchdog } from './parentWatchdog';
import { LairFailure, describeLairFailure } from './lairFailure';
const rustUtils = require('@lightningrodlabs/we-rust-utils');

const DEFAULT_APPS: Record<string, string> = {};

const LAIR_LAUNCH_ATTEMPTS = 3;

// One per Moss process: a relaunch after a failed attempt reuses it.
let parentWatchdog: ParentWatchdog | undefined;

function isLairFailure(e: unknown): e is LairFailure {
  return typeof e === 'object' && e !== null && 'kind' in e && 'detail' in e;
}

/**
 * A keystore that is still held by a process from an earlier session, or by a
 * short-lived file lock (antivirus, indexer), frees up within seconds. Stop what
 * this profile recorded, wait, and try again before giving up with a message the
 * user can act on. Any other failure is final on the first attempt.
 */
async function launchLairWithRetry(
  mossFileSystem: MossFileSystem,
  weEmitter: WeEmitter,
  password: string,
  runOptions: RunOptions,
  stopLeftovers: () => Leftover[],
  onSpawned: (pid: number) => void,
): Promise<[childProcess.ChildProcessWithoutNullStreams, string]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await launchLairKeystore(
        LAIR_BINARY,
        mossFileSystem.keystoreDir,
        weEmitter,
        password,
        runOptions.lairRustLog,
        onSpawned,
      );
    } catch (e) {
      const failure: LairFailure = isLairFailure(e) ? e : { kind: 'other', detail: String(e) };
      if (failure.kind === 'wrong-password') {
        throw new Error('Wrong password.');
      }
      if (failure.kind === 'keystore-busy' && attempt < LAIR_LAUNCH_ATTEMPTS) {
        weEmitter.emitMossLog(
          `Keystore busy on lair launch attempt ${attempt}/${LAIR_LAUNCH_ATTEMPTS} (${failure.detail}); stopping leftovers and retrying`,
        );
        stopLeftovers();
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        continue;
      }
      const message = describeLairFailure(failure, runOptions.profile);
      weEmitter.emitMossError(message);
      throw new Error(message);
    }
  }
}

export async function launch(
  mossFileSystem: MossFileSystem,
  weEmitter: WeEmitter,
  splashscreenWindow: BrowserWindow | undefined,
  password: string,
  runOptions: RunOptions,
): Promise<[childProcess.ChildProcessWithoutNullStreams, HolochainManager, WeRustHandler]> {
  console.log('LAIR BINARY PATH: ', LAIR_BINARY);
  //console.log('runOptions: ', JSON.stringify(runOptions, null, 2));
  if (!runOptions.relayUrl && !runOptions.bootstrapUrl) {
    throw new Error(
      `Failed to launch HolochainManager: neither bootstrapUrl nor relayUrl is set in runOptions.`,
    );
  }
  // A lair or conductor left behind by an earlier session of this profile still
  // holds the keystore pipe and the conductor database, and lair cannot start
  // against a keystore another lair holds. Stop them first; a failure here is
  // only logged, since the launch below reports the real problem if one remains.
  const stopLeftovers = (): Leftover[] => {
    try {
      // A live recorded Moss is never stopped from here: the owner check at
      // startup already asked the user about it, so one that appears now is a
      // healthy instance the user started in the meantime.
      const stopped = killLeftovers(mossFileSystem.profileDataDir, systemProbe, process.pid, {
        stopLiveOwner: false,
      });
      for (const leftover of stopped) {
        weEmitter.emitMossLog(
          `Stopped leftover ${leftover.name} process ${leftover.pid} (${leftover.binary}) from a previous session`,
        );
      }
      return stopped;
    } catch (e) {
      weEmitter.emitMossError(`Failed to check for leftover processes: ${e}`);
      return [];
    }
  };
  stopLeftovers();

  // Each child is recorded the moment it is spawned, so a Moss that is killed
  // while the conductor is still migrating still leaves a record for the next
  // start to act on. A failed write must not abort a launch that is otherwise
  // fine; it only costs the next start its cleanup.
  const spawnedChildren: ChildRecord[] = [];
  const recordChild = (name: ChildName, pid: number, binary: string) => {
    const existing = spawnedChildren.findIndex((c) => c.name === name);
    const record: ChildRecord = { name, pid, binary, startTime: systemProbe.startTime(pid) };
    if (existing >= 0) spawnedChildren[existing] = record;
    else spawnedChildren.push(record);
    const registry: ChildRegistry = {
      mossPid: process.pid,
      mossBinary: process.execPath,
      mossStartTime: systemProbe.startTime(process.pid),
      children: spawnedChildren,
    };
    try {
      writeChildRegistry(mossFileSystem.profileDataDir, registry);
    } catch (e) {
      weEmitter.emitMossError(`Failed to record ${name} pid ${pid}: ${e}`);
    }
    parentWatchdog?.update(registry);
  };

  // The watchdog stops these children should Moss die without reaching its
  // quit handler. Without it the registry above still covers the next start.
  if (!parentWatchdog) {
    try {
      // The bundler may place the caller in a chunk, so the script is located
      // from the app root rather than from __dirname.
      parentWatchdog = spawnParentWatchdog(
        path.join(app.getAppPath(), 'out', 'main', 'watchdog.js'),
        path.join(mossFileSystem.profileLogsDir, 'we.log'),
        path.join(mossFileSystem.profileLogsDir, 'watchdog.log'),
        (message) => weEmitter.emitMossError(message),
      );
      weEmitter.emitMossLog(`Spawned watchdog pid ${parentWatchdog.pid}`);
    } catch (e) {
      weEmitter.emitMossError(`Failed to spawn watchdog: ${e}`);
    }
  }

  // Initialize lair if necessary
  const lairHandleTemp = childProcess.spawnSync(LAIR_BINARY, ['--version']);
  if (!lairHandleTemp.stdout) {
    console.error(`Failed to run lair-keystore binary:\n${JSON.stringify(lairHandleTemp)}`);
  }
  console.log(`Got lair version ${lairHandleTemp.stdout.toString()}`);
  const currentLairVersion = lairHandleTemp.stdout.toString().trim();

  // Record the lair version that initializes/uses this keystore so that future
  // versions of Moss can detect compatibility before attempting an import.
  const lairVersionFile = path.join(mossFileSystem.keystoreDir, 'moss-lair-version.txt');
  if (!fs.existsSync(lairVersionFile)) {
    fs.writeFileSync(lairVersionFile, currentLairVersion, 'utf-8');
  }
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
  const [lairHandle, lairUrl] = await launchLairWithRetry(
    mossFileSystem,
    weEmitter,
    password,
    runOptions,
    stopLeftovers,
    (pid) => recordChild('lair', pid, LAIR_BINARY),
  );
  // Every deliberate stop goes through kill(), which sets `killed`; anything
  // else is a crash the log must show, since the UI keeps running against a
  // keystore that is no longer there. A Ctrl-C in a terminal reaches lair
  // before Moss's own quit does, so an exit while quitting is not a crash either.
  let quitting = false;
  app.once('before-quit', () => {
    quitting = true;
  });
  lairHandle.on('exit', (code, signal) => {
    if (lairHandle.killed || quitting) return;
    weEmitter.emitMossError(`Lair keystore exited unexpectedly (code ${code}, signal ${signal})`);
  });
  const holochainVersion = MOSS_CONFIG.holochain;

  if (splashscreenWindow)
    splashscreenWindow.webContents.send(
      'loading-progress-update',
      `Starting Holochain ${HOLOCHAIN_BINARY_VERSION}...`,
    );

  // launch holochain
  const conductorBinary = runOptions.customBinary
    ? runOptions.customBinary
    : HOLOCHAIN_BINARY;
  let holochainManager: HolochainManager;
  try {
    holochainManager = await HolochainManager.launch(
      weEmitter,
      mossFileSystem,
      conductorBinary,
      password,
      holochainVersion,
      mossFileSystem.conductorDir,
      mossFileSystem.conductorConfigPath,
      lairUrl,
      runOptions.bootstrapUrl!,
      runOptions.relayUrl!,
      runOptions.mdnsEnabled,
      runOptions.holochainRustLog,
      runOptions.holochainWasmLog,
      (pid) => recordChild('conductor', pid, conductorBinary),
    );
  } catch (e) {
    // lair is already running at this point; kill it so a failed launch (and each
    // splash-screen retry) doesn't leave an orphan lair against the keystore dir.
    lairHandle.kill();
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
    // Both lair and the conductor are running now; kill both so a failed launch
    // doesn't leave them orphaned holding the keystore and the admin port.
    lairHandle.kill();
    holochainManager.shutdown();
    weEmitter.emitMossError(`Failed to connect to WeRustHandler: ${e}`);
    throw new Error(`Failed to connect to WeRustHandler: ${e}`);
  }

  // Install default apps if necessary (not in applet-dev mode). Wrapped so
  // a failure in any post-spawn stage tears down the lair + conductor already
  // running instead of throwing past the launch IPC's destructuring and leaving
  // them orphaned holding the keystore and admin port.
  try {
    if (!runOptions.devInfo) {
      await Promise.all(
        Object.entries(DEFAULT_APPS).map(async ([appName, fileName]) => {
          const appId = `default-app#${appName.toLowerCase()}`; // convert to lowercase to be able to use it in custom protocol
          if (
            !holochainManager.installedApps
              .map((appInfo) => appInfo.installed_app_id)
              .includes(appId)
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
      await devSetup(runOptions.devInfo, holochainManager, mossFileSystem, false, weRustHandler);
    }
  } catch (e) {
    lairHandle.kill();
    holochainManager.shutdown();
    weEmitter.emitMossError(`Failed during post-launch setup: ${e}`);
    throw new Error(`Failed during post-launch setup: ${e}`);
  }
  return [lairHandle, holochainManager, weRustHandler];
}

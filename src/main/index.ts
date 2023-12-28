/* eslint-disable @typescript-eslint/no-var-requires */
import {
  app,
  BrowserWindow,
  ipcMain,
  IpcMainInvokeEvent,
  net,
  Tray,
  Menu,
  nativeImage,
  protocol,
  dialog,
  session,
  desktopCapturer,
} from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import * as childProcess from 'child_process';
import { createHash } from 'crypto';
import { Command, Option } from 'commander';
import { is } from '@electron-toolkit/utils';
import contextMenu from 'electron-context-menu';

import { AppAssetsInfo, DistributionInfo, WeFileSystem, deriveAppAssetsInfo } from './filesystem';
import { WeRustHandler, ZomeCallUnsignedNapi } from 'hc-we-rust-utils';
// import { AdminWebsocket } from '@holochain/client';
import { LauncherEmitter } from './launcherEmitter';
import { HolochainManager } from './holochainManager';
import { setupLogs } from './logs';
import { DEFAULT_APPS_DIRECTORY, ICONS_DIRECTORY } from './paths';
import { setLinkOpenHandlers } from './utils';
import { createHappWindow } from './windows';
import { APPSTORE_APP_ID, AppHashes } from './sharedTypes';
import { nanoid } from 'nanoid';
import { APPLET_DEV_TMP_FOLDER_PREFIX, validateArgs } from './cli';
import { launch } from './launch';
import { InstalledAppId } from '@holochain/client';
import { handleAppletProtocol, handleDefaultAppsProtocol } from './customSchemes';

const rustUtils = require('hc-we-rust-utils');

// https://github.com/nodeca/argparse/issues/128
// if (app.isPackaged) {
//   process.argv.splice(1, 0, '.');
// }

console.log('process.argv: ', process.argv);

const weCli = new Command();

weCli
  .name('Lightningrod Labs We')
  .description('Running We via the command line.')
  .version(app.getVersion())
  .option(
    '-p, --profile <string>',
    'Runs We with a custom profile with its own dedicated data store.',
  )
  .option(
    '-n, --network-seed <string>',
    'Installs AppStore with the provided network seed in case AppStore has not been installed yet.',
  )
  .option(
    '-c, --dev-config <path>',
    'Runs We in applet developer mode based on the configuration file at the specified path.',
  )
  .option(
    '-b, --bootstrap-url <url>',
    'URL of the bootstrap server to use. Must be provided if running in applet dev mode with the --dev-config argument.',
  )
  .option(
    '-s, --signaling-url <url>',
    'URL of the signaling server to use. Must be provided if running in applet dev mode with the --dev-config argument.',
  )
  .option(
    '--force-production-urls',
    'Explicitly allow using the production URLs of bootstrap and/or singaling server during applet development. It is recommended to use hc-local-services to spin up a local bootstrap and signaling server instead during development.',
  )
  .addOption(
    new Option(
      '--agent-num <number>',
      'To be provided when running with the --dev-config option. Specifies which agent (as defined in the config file) to run We for.',
    ).argParser(parseInt),
  );

weCli.parse();

console.log('GOT WECLI OPTIONS: ', weCli.opts());

const [PROFILE, APPSTORE_NETWORK_SEED, WE_APPLET_DEV_INFO, BOOTSTRAP_URL, SIGNALING_URL] =
  validateArgs(weCli.opts(), app);

// import * as rustUtils from 'hc-we-rust-utils';

// app.commandLine.appendSwitch('enable-logging');

const appName = app.getName();

if (process.env.NODE_ENV === 'development') {
  console.log('APP IS RUN IN DEVELOPMENT MODE');
  app.setName(appName + '-dev');
}

contextMenu({
  showSaveImageAs: true,
  showSearchWithGoogle: false,
});

console.log('APP PATH: ', app.getAppPath());
console.log('RUNNING ON PLATFORM: ', process.platform);

// const isFirstInstance = app.requestSingleInstanceLock();

// if (!isFirstInstance) {
//   app.quit();
// }

// app.on('second-instance', () => {
//   createOrShowMainWindow();
// });

if (WE_APPLET_DEV_INFO) {
  // garbage collect previously used folders
  const files = fs.readdirSync(os.tmpdir());
  const foldersToDelete = files.filter((file) =>
    file.startsWith(`${APPLET_DEV_TMP_FOLDER_PREFIX}-agent-${WE_APPLET_DEV_INFO.agentNum}`),
  );
  for (const folder of foldersToDelete) {
    fs.rmSync(path.join(os.tmpdir(), folder), { recursive: true, force: true, maxRetries: 4 });
  }
}

const WE_FILE_SYSTEM = WeFileSystem.connect(
  app,
  PROFILE,
  WE_APPLET_DEV_INFO ? WE_APPLET_DEV_INFO.tempDir : undefined,
);

const APPLET_IFRAME_SCRIPT = fs.readFileSync(
  path.resolve(__dirname, '../applet-iframe/index.mjs'),
  'utf-8',
);

const launcherEmitter = new LauncherEmitter();

setupLogs(launcherEmitter, WE_FILE_SYSTEM);

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'default-app',
    privileges: { standard: true, supportFetchAPI: true, secure: true, stream: true },
  },
]);

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'applet',
    privileges: { standard: true, supportFetchAPI: true, secure: true, stream: true },
  },
]);

let WE_RUST_HANDLER: WeRustHandler | undefined;
// let ADMIN_WEBSOCKET: AdminWebsocket | undefined;
// let ADMIN_PORT: number | undefined;
// let APP_PORT: number | undefined;
let HOLOCHAIN_MANAGER: HolochainManager | undefined;
let LAIR_HANDLE: childProcess.ChildProcessWithoutNullStreams | undefined;
let MAIN_WINDOW: BrowserWindow | undefined | null;
let SPLASH_SCREEN_WINDOW: BrowserWindow | undefined;
let isAppQuitting = false;

const handleSignZomeCall = (_e: IpcMainInvokeEvent, zomeCall: ZomeCallUnsignedNapi) => {
  if (!WE_RUST_HANDLER) throw Error('Rust handler is not ready');
  return WE_RUST_HANDLER.signZomeCall(zomeCall);
};

// // Handle creating/removing shortcuts on Windows when installing/uninstalling.
// if (require('electron-squirrel-startup')) {
//   app.quit();
// }

const createSplashscreenWindow = (): BrowserWindow => {
  // Create the browser window.
  const splashWindow = new BrowserWindow({
    height: 450,
    width: 800,
    center: true,
    resizable: false,
    frame: false,
    show: false,
    backgroundColor: '#331ead',
    // use these settings so that the ui
    // can listen for status change events
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/splashscreen.js'),
    },
  });

  // // and load the splashscreen.html of the app.
  // if (app.isPackaged) {
  //   splashWindow.loadFile(SPLASH_FILE);
  // } else {
  //   // development
  //   splashWindow.loadURL(`${DEVELOPMENT_UI_URL}/splashscreen.html`);
  // }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    splashWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/splashscreen.html`);
  } else {
    splashWindow.loadFile(path.join(__dirname, '../renderer/splashscreen.html'));
  }

  // once its ready to show, show
  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
  });

  // Open the DevTools.
  // mainWindow.webContents.openDevTools();
  return splashWindow;
};

const createOrShowMainWindow = () => {
  if (MAIN_WINDOW) {
    MAIN_WINDOW.show();
    return;
  }
  // Create the browser window.
  let mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/admin.js'),
      // autoplayPolicy: 'user-gesture-required',
    },
  });

  console.log('Creating main window');

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // // and load the index.html of the app.
  // if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
  //   mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  // } else {
  //   mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  // }

  setLinkOpenHandlers(mainWindow);

  // once its ready to show, show
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // Open the DevTools.
  if (!app.isPackaged || (app.isPackaged && !!WE_APPLET_DEV_INFO)) {
    mainWindow.webContents.openDevTools();
  }
  mainWindow.on('close', (e) => {
    // TODO add better UX around keeping it running in the background.
    // primarily important on Windows since the systray icon is hidden by default.
    // const choice = dialog.showMessageBox({
    //   title: "Remain Connected?",
    //   message:
    //     'Do you want to keep We running in the background to remain connected to your peers? You can re-open We via the system tray icon.',
    //   type: 'info',
    //   buttons: ['No', 'Yes'],
    // })
    console.log('Got close event: ', e);
    if (!isAppQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    // mainWindow = null;
    MAIN_WINDOW = null;
  });
  MAIN_WINDOW = mainWindow;
};

let tray;
// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  console.log('BEING RUN IN __dirnmane: ', __dirname);
  const mediaSourceWindow = new BrowserWindow({
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/selectmediasource.js'),
    },
  });
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mediaSourceWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/selectmediasource.html`);
  } else {
    mediaSourceWindow.loadFile(path.join(__dirname, '../renderer/selectmediasource.html'));
  }
  session.defaultSession.setPermissionRequestHandler(
    async (_webContents, permission, callback, details) => {
      if (permission === 'media') {
        let messageContent = `An Applet wants to access the following:${
          details.mediaTypes?.includes('video') ? '\n* camera' : ''
        }${details.mediaTypes?.includes('audio') ? '\n* microphone' : ''}`;
        if (!details.mediaTypes || details.mediaTypes.length === 0) {
          messageContent =
            'An Applet wants to access either or all of the following:\n* camera\n* microphone\n* screen share';
        }
        const response = await dialog.showMessageBox(MAIN_WINDOW!, {
          type: 'question',
          buttons: ['Deny', 'Allow'],
          defaultId: 0,
          cancelId: 0,
          message: messageContent,
        });
        if (response.response === 1) {
          callback(true);
        }
      }
      if (permission === 'clipboard-sanitized-write') {
        callback(true);
      }
      callback(false);
    },
  );
  const icon = nativeImage.createFromPath(path.join(ICONS_DIRECTORY, '16x16.png'));
  tray = new Tray(icon);

  handleAppletProtocol(WE_FILE_SYSTEM);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open',
      type: 'normal',
      click() {
        createOrShowMainWindow();
      },
    },
    {
      label: 'Quit',
      type: 'normal',
      click() {
        app.exit(0);
      },
    },
  ]);

  tray.setToolTip('Lightningrodlabs We');
  tray.setContextMenu(contextMenu);

  ipcMain.handle('exit', () => {
    app.exit(0);
  });
  ipcMain.handle('dialog-messagebox', async (_e, options: Electron.MessageBoxOptions) => {
    if (MAIN_WINDOW) {
      return dialog.showMessageBox(MAIN_WINDOW, options);
    } else {
      return Promise.reject('Main window does not exist.');
    }
  });
  ipcMain.handle('get-media-sources', () =>
    desktopCapturer.getSources({ types: ['window', 'screen'] }),
  );
  ipcMain.handle('sign-zome-call', handleSignZomeCall);
  ipcMain.handle('open-app', async (_e, appId: string) =>
    createHappWindow(appId, WE_FILE_SYSTEM, HOLOCHAIN_MANAGER!.appPort),
  );
  ipcMain.handle(
    'install-app',
    async (_e, filePath: string, appId: string, networkSeed: string) => {
      if (filePath === '#####REQUESTED_KANDO_INSTALLATION#####') {
        console.log('Got request to install KanDo.');
        filePath = path.join(DEFAULT_APPS_DIRECTORY, 'kando.webhapp');
      }
      if (!appId || appId === '') {
        throw new Error('No app id provided.');
      }
      await HOLOCHAIN_MANAGER!.installApp(filePath, appId, networkSeed);
    },
  );
  ipcMain.handle('is-applet-dev', (_e) => !!WE_APPLET_DEV_INFO);
  // ipcMain.handle('uninstall-app', async (_e, appId: string) => {
  //   await HOLOCHAIN_MANAGER!.uninstallApp(appId);
  // });
  ipcMain.handle(
    'get-all-app-assets-infos',
    async (): Promise<Record<InstalledAppId, AppAssetsInfo>> => {
      const allAppAssetsInfos: Record<InstalledAppId, AppAssetsInfo> = {};
      // Get all applets
      const allApps = await HOLOCHAIN_MANAGER!.adminWebsocket.listApps({});
      const allApplets = allApps.filter((appInfo) =>
        appInfo.installed_app_id.startsWith('applet#'),
      );
      // For each applet, read app assets info and add to record
      allApplets.forEach((appInfo) => {
        try {
          const appAssetsInfo = WE_FILE_SYSTEM.readAppAssetsInfo(appInfo.installed_app_id);
          allAppAssetsInfos[appInfo.installed_app_id] = appAssetsInfo;
        } catch (e) {
          console.warn(
            `Failed to read AppAssetsInfo for applet with app id ${appInfo.installed_app_id}`,
          );
        }
      });
      return allAppAssetsInfos;
    },
  );
  ipcMain.handle('get-applet-dev-port', (_e, appId: string) => {
    const appAssetsInfo = WE_FILE_SYSTEM.readAppAssetsInfo(appId);
    if (appAssetsInfo.type === 'webhapp' && appAssetsInfo.ui.location.type === 'localhost') {
      return appAssetsInfo.ui.location.port;
    }
    return undefined;
  });
  ipcMain.handle('get-applet-iframe-script', () => {
    return APPLET_IFRAME_SCRIPT;
  });
  ipcMain.handle('get-installed-apps', async () => {
    return HOLOCHAIN_MANAGER!.installedApps;
  });
  ipcMain.handle('get-conductor-info', async () => {
    return {
      app_port: HOLOCHAIN_MANAGER!.appPort,
      admin_port: HOLOCHAIN_MANAGER!.adminPort,
      appstore_app_id: APPSTORE_APP_ID,
    };
  });
  ipcMain.handle('lair-setup-required', async () => {
    return !WE_FILE_SYSTEM.keystoreInitialized();
  });
  ipcMain.handle('join-group', async (_e, networkSeed: string) => {
    const apps = await HOLOCHAIN_MANAGER!.adminWebsocket.listApps({});
    const hash = createHash('sha256');
    hash.update(networkSeed);
    const hashedSeed = hash.digest('base64');
    const appId = `group#${hashedSeed}`;
    console.log('Determined appId for group: ', appId);
    if (apps.map((appInfo) => appInfo.installed_app_id).includes(appId)) {
      await HOLOCHAIN_MANAGER!.adminWebsocket.enableApp({ installed_app_id: appId });
      return;
    }
    const appStoreAppInfo = apps.find((appInfo) => appInfo.installed_app_id === APPSTORE_APP_ID);
    if (!appStoreAppInfo)
      throw new Error('Appstore must be installed before installing the first group.');
    const appInfo = await HOLOCHAIN_MANAGER!.adminWebsocket.installApp({
      path: path.join(DEFAULT_APPS_DIRECTORY, 'we.happ'),
      installed_app_id: appId,
      agent_key: appStoreAppInfo.agent_pub_key,
      network_seed: networkSeed,
      membrane_proofs: {},
    });
    await HOLOCHAIN_MANAGER!.adminWebsocket.enableApp({ installed_app_id: appId });
    return appInfo;
  });
  ipcMain.handle('validate-happ-or-webhapp', async (_e, bytes: number[]): Promise<AppHashes> => {
    const hashResult = await rustUtils.validateHappOrWebhapp(bytes);
    const [happHash, uiHash, webHappHash] = hashResult.split('$');
    if (uiHash) {
      return {
        type: 'webhapp',
        sha256: webHappHash,
        happ: {
          sha256: happHash,
        },
        ui: {
          sha256: uiHash,
        },
      };
    } else {
      return {
        type: 'happ',
        sha256: happHash,
      };
    }
  });
  ipcMain.handle(
    'update-applet-ui',
    async (
      _e,
      appId: string,
      happOrWebHappUrl: string,
      distributionInfo: DistributionInfo,
      sha256Happ: string,
      sha256Ui: string,
      sha256Webhapp: string,
    ) => {
      // Check if UI assets need to be downloaded at all
      const uiAlreadyInstalled = fs.existsSync(
        path.join(WE_FILE_SYSTEM.uisDir, sha256Ui, 'assets'),
      );
      let tmpDir: string | undefined;
      if (!uiAlreadyInstalled) {
        // fetch webhapp from URL
        console.log('Fetching webhapp from URL: ', happOrWebHappUrl);
        const response = await net.fetch(happOrWebHappUrl);
        const buffer = await response.arrayBuffer();
        const assetBytes = Array.from(new Uint8Array(buffer));
        const result: string = await rustUtils.validateHappOrWebhapp(assetBytes);
        const [happHash, uiHash, webHappHash] = result.split('$');

        if (happHash !== sha256Happ)
          throw new Error(
            `The downloaded resource has an invalid happ hash. The source may be corrupted.\nGot hash '${happHash}' but expected hash ${sha256Happ}`,
          );
        if (webHappHash && webHappHash !== sha256Webhapp)
          throw new Error(
            `The downloaded resource has an invalid webhapp hash. The source may be corrupted.\nGot hash '${webHappHash}' but expected hash ${sha256Webhapp}`,
          );
        if (uiHash && uiHash !== sha256Ui)
          throw new Error(
            `The downloaded resource has an invalid UI hash. The source may be corrupted.\nGot hash '${uiHash}' but expected hash ${sha256Ui}`,
          );
        if (sha256Webhapp && !sha256Ui)
          throw new Error('Got applet with a webhapp hash but no UI hash.');

        tmpDir = path.join(os.tmpdir(), `we-applet-${nanoid(8)}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        const webHappPath = path.join(tmpDir, 'applet_to_install.webhapp');
        fs.writeFileSync(webHappPath, new Uint8Array(buffer));
        const uisDir = path.join(WE_FILE_SYSTEM.uisDir);
        const happsDir = path.join(WE_FILE_SYSTEM.happsDir);
        // NOTE: It's possible that an existing happ is being overwritten here. This shouldn't be a problem though.
        await rustUtils.saveHappOrWebhapp(webHappPath, uisDir, happsDir);
      } else {
        console.log(
          '@install-applet-bundle: UI already on the filesystem. Skipping download from remote source.',
        );
      }
      // That the happ hash is the same as with the previous installation needs to be checked in the frontend
      const appAssetsInfo: AppAssetsInfo = deriveAppAssetsInfo(
        distributionInfo,
        happOrWebHappUrl,
        sha256Happ,
        sha256Webhapp,
        sha256Ui,
      );
      WE_FILE_SYSTEM.backupAppAssetsInfo(appId);
      WE_FILE_SYSTEM.storeAppAssetsInfo(appId, appAssetsInfo);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  );
  ipcMain.handle(
    'install-applet-bundle',
    async (
      _e,
      appId: string,
      networkSeed: string,
      membraneProofs,
      agentPubKey,
      happOrWebHappUrl: string,
      distributionInfo: DistributionInfo,
      sha256Happ: string,
      sha256Ui?: string,
      sha256Webhapp?: string,
      metadata?: string,
    ) => {
      console.log('INSTALLING APPLET BUNDLE. metadata: ', metadata);
      const apps = await HOLOCHAIN_MANAGER!.adminWebsocket.listApps({});
      const alreadyInstalled = apps.find((appInfo) => appInfo.installed_app_id === appId);
      if (alreadyInstalled) {
        await HOLOCHAIN_MANAGER!.adminWebsocket.enableApp({ installed_app_id: appId });
        return;
      }
      // Check if .happ and ui assets are already installed on the filesystem and don't need to get fetched from the source
      let happAlreadyInstalledPath = path.join(WE_FILE_SYSTEM.happsDir, `${sha256Happ}.happ`);
      const happAlreadyInstalled = fs.existsSync(happAlreadyInstalledPath);
      const uiAlreadyInstalled =
        !!sha256Ui && fs.existsSync(path.join(WE_FILE_SYSTEM.uisDir, sha256Ui, 'assets'));

      let happToBeInstalledPath: string | undefined;
      let tmpDir: string | undefined;

      if (!happAlreadyInstalled || !uiAlreadyInstalled) {
        // fetch webhapp from URL
        console.log('Fetching happ/webhapp from URL: ', happOrWebHappUrl);
        const response = await net.fetch(happOrWebHappUrl);
        const buffer = await response.arrayBuffer();

        const uisDir = path.join(WE_FILE_SYSTEM.uisDir);
        const happsDir = path.join(WE_FILE_SYSTEM.happsDir);

        const assetBytes = Array.from(new Uint8Array(buffer));
        const validationResult: string = await rustUtils.validateHappOrWebhapp(assetBytes);
        const [happHashVal, uiHashVal, webHappHashVal] = validationResult.split('$');

        if (happHashVal !== sha256Happ)
          throw new Error(
            `The downloaded resource has an invalid happ hash. The source may be corrupted.\nGot hash '${happHashVal}' but expected hash ${sha256Happ}`,
          );
        if (webHappHashVal && webHappHashVal !== sha256Webhapp)
          throw new Error(
            `The downloaded resource has an invalid webhapp hash. The source may be corrupted.\nGot hash '${webHappHashVal}' but expected hash ${sha256Webhapp}`,
          );
        if (uiHashVal && uiHashVal !== sha256Ui)
          throw new Error(
            `The downloaded resource has an invalid UI hash. The source may be corrupted.\nGot hash '${uiHashVal}' but expected hash ${sha256Ui}`,
          );
        if (sha256Webhapp && !sha256Ui)
          throw new Error('Got applet with a webhapp hash but no UI hash.');

        tmpDir = path.join(os.tmpdir(), `we-applet-${nanoid(8)}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        const webHappPath = path.join(tmpDir, 'applet_to_install.webhapp');
        fs.writeFileSync(webHappPath, new Uint8Array(buffer));
        // NOTE: It's possible that an existing happ is being overwritten here. This shouldn't be a problem though.
        const result: string = await rustUtils.saveHappOrWebhapp(webHappPath, uisDir, happsDir);
        const [happFilePath, _] = result.split('$');
        happToBeInstalledPath = happFilePath;
      } else {
        console.log(
          '@install-applet-bundle: happ and UI already on the filesystem. Skipping download from remote source.',
        );
      }

      const appInfo = await HOLOCHAIN_MANAGER!.adminWebsocket.installApp({
        path: happToBeInstalledPath ? happToBeInstalledPath : happAlreadyInstalledPath,
        installed_app_id: appId,
        agent_key: agentPubKey,
        network_seed: networkSeed,
        membrane_proofs: membraneProofs,
      });
      await HOLOCHAIN_MANAGER!.adminWebsocket.enableApp({ installed_app_id: appId });
      // TODO Store more app metadata
      // Store app metadata
      let uiPort: number | undefined;
      if (metadata) {
        try {
          const metadataObject = JSON.parse(metadata);
          if (metadataObject.uiPort) {
            uiPort = metadataObject.uiPort;
          }
        } catch (e) {}
      }
      const appAssetsInfo: AppAssetsInfo = deriveAppAssetsInfo(
        distributionInfo,
        happOrWebHappUrl,
        sha256Happ,
        sha256Webhapp,
        sha256Ui,
        uiPort,
      );
      WE_FILE_SYSTEM.storeAppAssetsInfo(appId, appAssetsInfo);
      // remove temp dir again
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
      console.log('@install-applet-bundle: app installed.');
      return appInfo;
    },
  );
  ipcMain.handle('launch', async (_e, password) => {
    // const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // await delay(5000);
    [LAIR_HANDLE, HOLOCHAIN_MANAGER, WE_RUST_HANDLER] = await launch(
      WE_FILE_SYSTEM,
      launcherEmitter,
      SPLASH_SCREEN_WINDOW,
      password,
      BOOTSTRAP_URL,
      SIGNALING_URL,
      APPSTORE_NETWORK_SEED,
      WE_APPLET_DEV_INFO,
    );

    handleDefaultAppsProtocol(WE_FILE_SYSTEM, HOLOCHAIN_MANAGER);

    if (SPLASH_SCREEN_WINDOW) SPLASH_SCREEN_WINDOW.close();
    createOrShowMainWindow();
  });

  if (WE_APPLET_DEV_INFO) {
    [LAIR_HANDLE, HOLOCHAIN_MANAGER, WE_RUST_HANDLER] = await launch(
      WE_FILE_SYSTEM,
      launcherEmitter,
      undefined,
      'dummy-dev-password :)',
      BOOTSTRAP_URL,
      SIGNALING_URL,
      APPSTORE_NETWORK_SEED,
      WE_APPLET_DEV_INFO,
    );
    createOrShowMainWindow();
  } else {
    SPLASH_SCREEN_WINDOW = createSplashscreenWindow();
  }
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  // if (process.platform !== 'darwin') {
  //   app.quit();
  // }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createOrShowMainWindow();
  }
});

app.on('before-quit', () => {
  isAppQuitting = true;
});

app.on('quit', () => {
  if (LAIR_HANDLE) {
    LAIR_HANDLE.kill();
  }
  if (HOLOCHAIN_MANAGER) {
    HOLOCHAIN_MANAGER.processHandle.kill();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

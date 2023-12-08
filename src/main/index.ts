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
} from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import * as childProcess from 'child_process';
import url from 'url';
import { createHash } from 'crypto';
import { ArgumentParser } from 'argparse';
import { is } from '@electron-toolkit/utils';
import contextMenu from 'electron-context-menu';

import { AppAssetsInfo, WeFileSystem } from './filesystem';
import { holochianBinaries, lairBinary } from './binaries';
import { WeRustHandler, ZomeCallUnsignedNapi } from 'hc-we-rust-utils';
// import { AdminWebsocket } from '@holochain/client';
import { initializeLairKeystore, launchLairKeystore } from './lairKeystore';
import { LauncherEmitter } from './launcherEmitter';
import { HolochainManager } from './holochainManager';
import { setupLogs } from './logs';
import { DEFAULT_APPS_DIRECTORY, ICONS_DIRECTORY } from './paths';
import { setLinkOpenHandlers } from './utils';
import { createHappWindow } from './windows';
import { APPSTORE_APP_ID } from './sharedTypes';

const rustUtils = require('hc-we-rust-utils');

// https://github.com/nodeca/argparse/issues/128
if (app.isPackaged) {
  process.argv.splice(1, 0, 'placeholder');
}

const parser = new ArgumentParser({
  description: 'Lightningrodlabs We',
});
parser.add_argument('-p', '--profile', {
  help: 'Opens We with a custom profile instead of the default profile.',
  type: 'string',
});

const allowedProfilePattern = /^[0-9a-zA-Z-]+$/;

const args = parser.parse_args();
if (args.profile && !allowedProfilePattern.test(args.profile)) {
  throw new Error(
    'The --profile argument may only contain digits (0-9), letters (a-z,A-Z) and dashes (-)',
  );
}

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

const WE_FILE_SYSTEM = WeFileSystem.connect(app, args.profile);
const launcherEmitter = new LauncherEmitter();

const APPLET_IFRAME_SCRIPT = fs.readFileSync(
  path.resolve(__dirname, '../applet-iframe/index.mjs'),
  'utf-8',
);

setupLogs(launcherEmitter, WE_FILE_SYSTEM);

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'applet',
    privileges: { standard: true, supportFetchAPI: true },
  },
]);

let WE_RUST_HANDLER: WeRustHandler | undefined;
// let ADMIN_WEBSOCKET: AdminWebsocket | undefined;
// let ADMIN_PORT: number | undefined;
// let APP_PORT: number | undefined;
let HOLOCHAIN_MANAGER: HolochainManager | undefined;
let LAIR_HANDLE: childProcess.ChildProcessWithoutNullStreams | undefined;
let MAIN_WINDOW: BrowserWindow | undefined | null;

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
      webSecurity: false,
      allowRunningInsecureContent: true,
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
  mainWindow.webContents.openDevTools();
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
  const icon = nativeImage.createFromPath(path.join(ICONS_DIRECTORY, '16x16.png'));
  tray = new Tray(icon);
  // session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  //   if (details.url.startsWith('applet://')) {
  //     console.log('GOT REQUEST FROM APPLET. URL: ', details.url);
  //     callback({
  //       responseHeaders: {
  //         ...details.responseHeaders,
  //         'Content-Security-Policy': "default-src 'self' ws: 'unsafe-inline' 'unsafe-eval'",
  //       },
  //     });
  //   } else {
  //     callback({ cancel: false });
  //   }
  // });
  protocol.handle('applet', async (request) => {
    // console.log('### Got applet request: ', request);
    // console.log('### Got request with url: ', request.url);
    const uriWithoutProtocol = request.url.split('://')[1];
    const uriWithoutQueryString = uriWithoutProtocol.split('?')[0];
    const uriComponents = uriWithoutQueryString.split('/');
    const lowerCasedAppletId = uriComponents[0].replaceAll('%24', '$');

    const installedAppId = `applet#${lowerCasedAppletId}`;

    const uiAssetsDir = WE_FILE_SYSTEM.appUiAssetsDir(installedAppId);

    // console.log('uiAssetsDir: ', uiAssetsDir);
    // console.log('uriWithoutProtocol: ', uriWithoutProtocol);
    // console.log('uriWithoutQueryString: ', uriWithoutQueryString);
    // console.log('uriComponents: ', uriComponents);

    if (!uiAssetsDir) {
      throw new Error(`Failed to find UI assets directory for requested applet assets.`);
    }

    if (
      uriComponents.length === 1 ||
      (uriComponents.length === 2 && (uriComponents[1] === '' || uriComponents[1] === 'index.html'))
    ) {
      const indexHtmlResponse = await net.fetch(
        url.pathToFileURL(path.join(uiAssetsDir, 'index.html')).toString(),
      );

      console.log('$$$$$ index.html headers: ', indexHtmlResponse.headers);

      const content = await indexHtmlResponse.text();
      // console.log('APPLET_IFRAME_SCRIPT: ', APPLET_IFRAME_SCRIPT);
      console.log(
        'original content contains weird comination?',
        content.includes('}<!DOCTYPE html>'),
      );
      console.log(
        'APPLET_IFRAME_SCRIPT contains weird comination?',
        APPLET_IFRAME_SCRIPT.includes('}<!DOCTYPE html>'),
      );
      console.log(
        '<head><script>${APPLET_IFRAME_SCRIPT}</script> contains weird comination?',
        `<head><script>${APPLET_IFRAME_SCRIPT}</script>`.includes('}<!DOCTYPE html>'),
      );

      // lit uses the $` combination (https://github.com/lit/lit/issues/4433) so string replacement
      // needs to happen a bit cumbersomely
      const htmlComponents = content.split('<head>');
      htmlComponents.splice(1, 0, '<head>');
      htmlComponents.splice(2, 0, `<script type="module">${APPLET_IFRAME_SCRIPT}</script>`);
      let modifiedContent = htmlComponents.join('');
      console.log(
        'modifiedContent contains weird comination?',
        modifiedContent.includes('}<!DOCTYPE html>'),
      );
      // remove title attribute to be able to set title to app id later
      modifiedContent = modifiedContent.replace(/<title>.*?<\/title>/i, '');
      const response = new Response(modifiedContent, indexHtmlResponse);
      return response;
    } else {
      return net.fetch(
        url.pathToFileURL(path.join(uiAssetsDir, ...uriComponents.slice(1))).toString(),
      );
    }
  });

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
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Holochain Launcher');
  tray.setContextMenu(contextMenu);

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
  // ipcMain.handle('uninstall-app', async (_e, appId: string) => {
  //   await HOLOCHAIN_MANAGER!.uninstallApp(appId);
  // });
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
  // ipcMain.handle('is-dev-mode-enabled', async () => {
  //   const enabledApps = await HOLOCHAIN_MANAGER!.adminWebsocket.listApps({
  //     status_filter: AppStatusFilter.Enabled,
  //   });
  //   if (enabledApps.map((appInfo) => appInfo.installed_app_id).includes(DEVHUB_APP_ID)) {
  //     return true;
  //   }
  //   return false;
  // });
  // ipcMain.handle('enable-dev-mode', async () => {
  //   const installedApps = await HOLOCHAIN_MANAGER!.adminWebsocket.listApps({});
  //   if (installedApps.map((appInfo) => appInfo.installed_app_id).includes(DEVHUB_APP_ID)) {
  //     HOLOCHAIN_MANAGER!.adminWebsocket.enableApp({ installed_app_id: DEVHUB_APP_ID });
  //   } else {
  //     await HOLOCHAIN_MANAGER!.installApp(
  //       path.join(DEFAULT_APPS_DIRECTORY, 'DevHub.webhapp'),
  //       path.join(WE_FILE_SYSTEM.uisDir, DEVHUB_APP_ID, 'assets'),
  //       DEVHUB_APP_ID,
  //       'launcher-electron-prototype',
  //     );
  //   }
  // });
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
  ipcMain.handle(
    'install-applet-bundle',
    async (_e, appId, networkSeed, membraneProofs, agentPubKey, webHappUrl) => {
      const apps = await HOLOCHAIN_MANAGER!.adminWebsocket.listApps({});
      const alreadyInstalled = apps.find((appInfo) => appInfo.installed_app_id === appId);
      if (alreadyInstalled) {
        await HOLOCHAIN_MANAGER!.adminWebsocket.enableApp({ installed_app_id: appId });
        return;
      }
      // fetch webhapp from URL
      const response = await fetch(webHappUrl);
      const buffer = await response.arrayBuffer();
      const tmpDir = path.join(os.tmpdir(), fs.mkdtempSync('we-applet'));
      fs.mkdirSync(tmpDir, { recursive: true });
      const webHappPath = path.join(tmpDir, 'applet_to_install.webhapp');
      console.log('webhapp path: ', webHappPath);
      fs.writeFileSync(webHappPath, new Uint8Array(buffer));
      console.log('webhapp path exists: ', fs.existsSync(webHappPath));

      const uisDir = path.join(WE_FILE_SYSTEM.uisDir);
      const happsDir = path.join(WE_FILE_SYSTEM.happsDir);

      const result: string = await rustUtils.saveWebhapp(webHappPath, uisDir, happsDir);
      const [happFilePath, happHash, uiHash] = result.split('$');

      const appInfo = await HOLOCHAIN_MANAGER!.adminWebsocket.installApp({
        path: happFilePath,
        installed_app_id: appId,
        agent_key: agentPubKey,
        network_seed: networkSeed,
        membrane_proofs: membraneProofs,
      });
      await HOLOCHAIN_MANAGER!.adminWebsocket.enableApp({ installed_app_id: appId });
      // TODO Store more app metadata
      // Store app metadata
      const appAssetsInfo: AppAssetsInfo = {
        type: 'webhapp',
        source: {
          type: 'https',
          url: webHappUrl,
        },
        happIdentifier: happHash,
        uiIdentifier: uiHash,
      };
      fs.writeFileSync(
        path.join(WE_FILE_SYSTEM.appsDir, `${appId}.json`),
        JSON.stringify(appAssetsInfo, undefined, 4),
      );
      // remove temp dir again
      fs.rmSync(tmpDir, { recursive: true, force: true });
      console.log('@install-applet-bundle: app installed.');
      return appInfo;
    },
  );
  // ipcMain.handle('fetch-icon', async (_e, appActionHashB64: ActionHashB64) => {
  //   if (!APPSTORE_CLIENT) {
  //     APPSTORE_CLIENT = await AppAgentWebsocket.connect(
  //       new URL(`ws://127.0.0.1:${HOLOCHAIN_MANAGER!.appPort}`),
  //       APPSTORE_APP_ID,
  //     );
  //   }
  //   const appEntryEntity: any = await APPSTORE_CLIENT.callZome({
  //     role_name: 'appstore',
  //     zome_name: 'appstore_api',
  //     fn_name: 'get_app',
  //     payload: {
  //       id: decodeHashFromBase64(appActionHashB64),
  //     },
  //   });
  //   const essenceResponse = await APPSTORE_CLIENT.callZome({
  //     role_name: 'appstore',
  //     zome_name: 'mere_memory_api',
  //     fn_name: 'retrieve_bytes',
  //     payload: appEntryEntity.content.icon,
  //   });
  //   console.log('Got essenceResponse: ', essenceResponse);
  //   const mimeType = appEntryEntity.content.metadata.icon_mime_type;
  //   console.log('ICON MIME TYPE: ', mimeType);

  //   const base64String = fromUint8Array(essenceResponse);

  //   const iconSrc = `data:${mimeType};base64,${base64String}`;

  //   return iconSrc;
  // });

  const splashscreenWindow = createSplashscreenWindow();

  ipcMain.handle('launch', async (_e, password) => {
    // const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // await delay(5000);

    console.log('LAIR BINARY PATH: ', lairBinary);
    // Initialize lair if necessary
    const lairHandleTemp = childProcess.spawnSync(lairBinary, ['--version']);
    if (!lairHandleTemp.stdout) {
      console.error(`Failed to run lair-keystore binary:\n${JSON.stringify(lairHandleTemp)}`);
    }
    console.log(`Got lair version ${lairHandleTemp.stdout.toString()}`);
    if (!WE_FILE_SYSTEM.keystoreInitialized()) {
      splashscreenWindow.webContents.send('loading-progress-update', 'Starting lair keystore...');
      // TODO: https://github.com/holochain/launcher/issues/144
      // const lairHandle = childProcess.spawn(lairBinary, ["init", "-p"], { cwd: WE_FILE_SYSTEM.keystoreDir });
      // lairHandle.stdin.write(password);
      // lairHandle.stdin.end();
      // lairHandle.stdout.pipe(split()).on("data", (line: string) => {
      //   console.log("[LAIR INIT]: ", line);
      // })
      await initializeLairKeystore(
        lairBinary,
        WE_FILE_SYSTEM.keystoreDir,
        launcherEmitter,
        password,
      );
    }
    splashscreenWindow.webContents.send('loading-progress-update', 'Starting lair keystore...');

    // launch lair keystore
    const [lairHandle, lairUrl] = await launchLairKeystore(
      lairBinary,
      WE_FILE_SYSTEM.keystoreDir,
      launcherEmitter,
      password,
    );
    LAIR_HANDLE = lairHandle;
    // create zome call signer

    splashscreenWindow.webContents.send('loading-progress-update', 'Starting Holochain...');

    // launch holochain
    const holochainManager = await HolochainManager.launch(
      launcherEmitter,
      WE_FILE_SYSTEM,
      holochianBinaries['holochain-0.2.3'],
      password,
      '0.2.3',
      WE_FILE_SYSTEM.conductorDir,
      WE_FILE_SYSTEM.conductorConfigPath,
      lairUrl,
      'https://bootstrap.holo.host',
      'wss://signal.holo.host',
    );
    // ADMIN_PORT = holochainManager.adminPort;
    // ADMIN_WEBSOCKET = holochainManager.adminWebsocket;
    // APP_PORT = holochainManager.appPort;cd di
    HOLOCHAIN_MANAGER = holochainManager;

    WE_RUST_HANDLER = await rustUtils.WeRustHandler.connect(
      lairUrl,
      holochainManager.adminPort,
      holochainManager.appPort,
      password,
    );

    // Install default apps if necessary:
    if (
      !HOLOCHAIN_MANAGER.installedApps
        .map((appInfo) => appInfo.installed_app_id)
        .includes(APPSTORE_APP_ID)
    ) {
      console.log('Installing AppStore...');
      splashscreenWindow.webContents.send('loading-progress-update', 'Installing AppStore...');
      await HOLOCHAIN_MANAGER.installApp(
        path.join(DEFAULT_APPS_DIRECTORY, 'AppstoreLight.happ'),
        APPSTORE_APP_ID,
        'lightningrodlabs-we-electron',
      );
      console.log('AppstoreLight installed.');
    }
    splashscreenWindow.close();
    createOrShowMainWindow();
  });
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

// app.on('will-quit', (e: Event) => {
//   // let the launcher run in the background (systray)
//   // e.preventDefault();
// })

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

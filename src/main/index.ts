/* eslint-disable @typescript-eslint/no-var-requires */
import {
  app,
  BrowserWindow,
  ipcMain,
  IpcMainInvokeEvent,
  net,
  session,
  Tray,
  Menu,
  nativeImage,
} from 'electron';
import path from 'path';
import * as childProcess from 'child_process';
import url from 'url';
import { ArgumentParser } from 'argparse';
import { is } from '@electron-toolkit/utils';

import { WeFileSystem } from './filesystem';
import { holochianBinaries, lairBinary } from './binaries';
import { WeRustHandler, ZomeCallUnsignedNapi } from 'hc-launcher-rust-utils';
// import { AdminWebsocket } from '@holochain/client';
import { initializeLairKeystore, launchLairKeystore } from './lairKeystore';
import { LauncherEmitter } from './launcherEmitter';
import { HolochainManager } from './holochainManager';
import { setupLogs } from './logs';
import { DEFAULT_APPS_DIRECTORY, ICONS_DIRECTORY } from './paths';
import { setLinkOpenHandlers } from './utils';
import { AppAgentWebsocket, AppStatusFilter } from '@holochain/client';

const rustUtils = require('hc-launcher-rust-utils');
// import * as rustUtils from 'hc-launcher-rust-utils';

const APPSTORE_APP_ID = 'AppStore';
const DEVHUB_APP_ID = 'DevHub';

const appName = app.getName();

if (process.env.NODE_ENV === 'development') {
  console.log('APP IS RUN IN DEVELOPMENT MODE');
  app.setName(appName + '-dev');
}

console.log('APP PATH: ', app.getAppPath());
console.log('RUNNING ON PLATFORM: ', process.platform);

const parser = new ArgumentParser({
  description: 'Holochain Launcher',
});
parser.add_argument('-p', '--profile', {
  help: 'Opens the launcher with a custom profile instead of the default profile.',
  type: 'string',
});

const allowedProfilePattern = /^[0-9a-zA-Z-]+$/;
const args = parser.parse_args();
if (args.profile && !allowedProfilePattern.test(args.profile)) {
  throw new Error(
    'The --profile argument may only contain digits (0-9), letters (a-z,A-Z) and dashes (-)',
  );
}

const isFirstInstance = app.requestSingleInstanceLock();

if (!isFirstInstance) {
  app.quit();
}

app.on('second-instance', () => {
  createOrShowMainWindow();
});

const launcherFileSystem = WeFileSystem.connect(app, args.profile);
const launcherEmitter = new LauncherEmitter();

setupLogs(launcherEmitter, launcherFileSystem);

let WE_RUST_HANDLER: WeRustHandler | undefined;
// let ADMIN_WEBSOCKET: AdminWebsocket | undefined;
// let ADMIN_PORT: number | undefined;
let APP_PORT: number | undefined;
let HOLOCHAIN_MANAGER: HolochainManager | undefined;
let LAIR_HANDLE: childProcess.ChildProcessWithoutNullStreams | undefined;
let MAIN_WINDOW: BrowserWindow | undefined | null;
let APPSTORE_CLIENT: AppAgentWebsocket | undefined;

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
  const ses = session.defaultSession;
  ses.protocol.handle('applet', async (request) => {
    // console.log("### Got file request: ", request);
    const uriWithoutProtocol = request.url.split('://')[1];
    const uriWithoutQueryString = uriWithoutProtocol.split('?')[0];
    const uriComponents = uriWithoutQueryString.split('/');
    const appletId = uriComponents[0];

    const installedAppId = `applet#${appletId}`;

    const uiAssetsDir = launcherFileSystem.appUiAssetsDir(installedAppId);

    if (!uiAssetsDir) {
      throw new Error(`Failed to find UI assets directory for requested applet assets.`);
    }

    if (
      uriComponents.length === 2 &&
      (uriComponents[1] === '' || uriComponents[1] === 'index.html')
    ) {
      const indexHtmlResponse = await net.fetch(
        url.pathToFileURL(path.join(uiAssetsDir, 'index.html')).toString(),
      );
      const content = await indexHtmlResponse.text();
      let modifiedContent = content.replace(
        '<head>',
        `<head><script type="module">window.__HC_LAUNCHER_ENV__ = { APP_INTERFACE_PORT: ${APP_PORT}, INSTALLED_APP_ID: "${installedAppId}", FRAMEWORK: "electron" };</script>`,
      );
      // remove title attribute to be able to set title to app id later
      modifiedContent = modifiedContent.replace(/<title>.*?<\/title>/i, '');
      return new Response(modifiedContent, indexHtmlResponse);
    } else {
      return net.fetch(
        url.pathToFileURL(path.join(uiAssetsDir, ...uriComponents.slice(1))).toString(),
      );
    }
  });
  // Create the browser window.
  let mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/admin.js'),
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

const createHappWindow = (appId: string) => {
  // TODO create mapping between installed-app-id's and window ids

  const uiAssetsDir = launcherFileSystem.appUiAssetsDir(appId);
  if (!uiAssetsDir) {
    throw new Error(`No directory found for UI assets. Is it a headless app?`);
  }

  const partition = `persist:${appId}`;
  const ses = session.fromPartition(partition);

  ses.protocol.handle('file', async (request) => {
    // console.log("### Got file request: ", request);
    const filePath = request.url.slice('file://'.length);
    console.log('filePath: ', filePath);
    if (!filePath.endsWith('index.html')) {
      return net.fetch(url.pathToFileURL(path.join(uiAssetsDir, filePath)).toString());
    } else {
      const indexHtmlResponse = await net.fetch(request.url);
      const content = await indexHtmlResponse.text();
      let modifiedContent = content.replace(
        '<head>',
        `<head><script type="module">window.__HC_LAUNCHER_ENV__ = { APP_INTERFACE_PORT: ${APP_PORT}, INSTALLED_APP_ID: "${appId}", FRAMEWORK: "electron" };</script>`,
      );
      // remove title attribute to be able to set title to app id later
      modifiedContent = modifiedContent.replace(/<title>.*?<\/title>/i, '');
      return new Response(modifiedContent, indexHtmlResponse);
    }
  });
  // Create the browser window.
  let happWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/happs.js'),
      partition,
    },
  });

  happWindow.menuBarVisible = false;

  happWindow.setTitle(appId);

  setLinkOpenHandlers(happWindow);

  happWindow.on('close', () => {
    console.log(`Happ window with frame id ${happWindow.id} about to be closed.`);
    // prevent closing here and hide instead in case notifications are to be received from this happ UI
  });

  happWindow.on('closed', () => {
    console.log(`Happ window with frame id ${happWindow.id} closed.`);
    // remove protocol handler
    ses.protocol.unhandle('file');
    // happWindow = null;
  });
  console.log('Loading happ window file');
  happWindow.loadFile(path.join(uiAssetsDir, 'index.html'));
};

let tray;
// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  console.log('BEING RUN IN __dirnmane: ', __dirname);
  const icon = nativeImage.createFromPath(path.join(ICONS_DIRECTORY, '16x16.png'));
  tray = new Tray(icon);

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
  ipcMain.handle('open-app', async (_e, appId: string) => createHappWindow(appId));
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
      devhub_app_id: DEVHUB_APP_ID,
    };
  });
  ipcMain.handle('lair-setup-required', async () => {
    return !launcherFileSystem.keystoreInitialized();
  });
  ipcMain.handle('is-dev-mode-enabled', async () => {
    const enabledApps = await HOLOCHAIN_MANAGER!.adminWebsocket.listApps({
      status_filter: AppStatusFilter.Enabled,
    });
    if (enabledApps.map((appInfo) => appInfo.installed_app_id).includes(DEVHUB_APP_ID)) {
      return true;
    }
    return false;
  });
  ipcMain.handle('enable-dev-mode', async () => {
    const installedApps = await HOLOCHAIN_MANAGER!.adminWebsocket.listApps({});
    if (installedApps.map((appInfo) => appInfo.installed_app_id).includes(DEVHUB_APP_ID)) {
      HOLOCHAIN_MANAGER!.adminWebsocket.enableApp({ installed_app_id: DEVHUB_APP_ID });
    } else {
      await HOLOCHAIN_MANAGER!.installApp(
        path.join(DEFAULT_APPS_DIRECTORY, 'DevHub.webhapp'),
        path.join(launcherFileSystem.uisDir, DEVHUB_APP_ID, 'assets'),
        DEVHUB_APP_ID,
        'launcher-electron-prototype',
      );
    }
  });
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
    if (!launcherFileSystem.keystoreInitialized()) {
      splashscreenWindow.webContents.send('loading-progress-update', 'Starting lair keystore...');
      // TODO: https://github.com/holochain/launcher/issues/144
      // const lairHandle = childProcess.spawn(lairBinary, ["init", "-p"], { cwd: launcherFileSystem.keystoreDir });
      // lairHandle.stdin.write(password);
      // lairHandle.stdin.end();
      // lairHandle.stdout.pipe(split()).on("data", (line: string) => {
      //   console.log("[LAIR INIT]: ", line);
      // })
      await initializeLairKeystore(
        lairBinary,
        launcherFileSystem.keystoreDir,
        launcherEmitter,
        password,
      );
    }
    splashscreenWindow.webContents.send('loading-progress-update', 'Starting lair keystore...');

    // launch lair keystore
    const [lairHandle, lairUrl] = await launchLairKeystore(
      lairBinary,
      launcherFileSystem.keystoreDir,
      launcherEmitter,
      password,
    );
    LAIR_HANDLE = lairHandle;
    // create zome call signer

    splashscreenWindow.webContents.send('loading-progress-update', 'Starting Holochain...');

    // launch holochain
    const holochainManager = await HolochainManager.launch(
      launcherEmitter,
      launcherFileSystem,
      holochianBinaries['holochain-0.2.3'],
      password,
      '0.2.3',
      launcherFileSystem.conductorDir,
      launcherFileSystem.conductorConfigPath,
      lairUrl,
      'https://bootstrap.holo.host',
      'wss://signal.holo.host',
    );
    // ADMIN_PORT = holochainManager.adminPort;
    // ADMIN_WEBSOCKET = holochainManager.adminWebsocket;
    APP_PORT = holochainManager.appPort;
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
        path.join(DEFAULT_APPS_DIRECTORY, 'AppStore.webhapp'),
        path.join(launcherFileSystem.uisDir, APPSTORE_APP_ID, 'assets'),
        APPSTORE_APP_ID,
        'launcher-electron-prototype',
      );
      console.log('AppStore installed.');
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

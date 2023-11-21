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

import { LauncherFileSystem } from './filesystem';
import { holochianBinaries, lairBinary } from './binaries';
import { ZomeCallSigner, ZomeCallUnsignedNapi } from 'hc-launcher-rust-utils';
// import { AdminWebsocket } from '@holochain/client';
import { initializeLairKeystore, launchLairKeystore } from './lairKeystore';
import { LauncherEmitter } from './launcherEmitter';
import { HolochainManager } from './holochainManager';
import { setupLogs } from './logs';
import { DEFAULT_APPS_DIRECTORY, ICONS_DIRECTORY } from './paths';

const rustUtils = require('hc-launcher-rust-utils');
// import * as rustUtils from 'hc-launcher-rust-utils';

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

const launcherFileSystem = LauncherFileSystem.connect(app, args.profile);
const launcherEmitter = new LauncherEmitter();

setupLogs(launcherEmitter);

let ZOME_CALL_SIGNER: ZomeCallSigner | undefined;
// let ADMIN_WEBSOCKET: AdminWebsocket | undefined;
// let ADMIN_PORT: number | undefined;
let APP_PORT: number | undefined;
let HOLOCHAIN_MANAGER: HolochainManager | undefined;
let LAIR_HANDLE: childProcess.ChildProcessWithoutNullStreams | undefined;
let MAIN_WINDOW: BrowserWindow | undefined | null;

const handleSignZomeCall = (_e: IpcMainInvokeEvent, zomeCall: ZomeCallUnsignedNapi) => {
  if (!ZOME_CALL_SIGNER) throw Error('Lair signer is not ready');
  return ZOME_CALL_SIGNER.signZomeCall(zomeCall);
};

// // Handle creating/removing shortcuts on Windows when installing/uninstalling.
// if (require('electron-squirrel-startup')) {
//   app.quit();
// }

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

  const partition = `persist:${appId}`;
  const ses = session.fromPartition(partition);
  ses.protocol.handle('file', async (request) => {
    // console.log("### Got file request: ", request);
    const filePath = request.url.slice('file://'.length);
    console.log('filePath: ', filePath);
    if (!filePath.endsWith('index.html')) {
      return net.fetch(
        url.pathToFileURL(path.join(launcherFileSystem.appUiDir(appId), filePath)).toString(),
      );
    } else {
      const indexHtmlResponse = await net.fetch(url.pathToFileURL(filePath).toString());
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

  happWindow.setTitle(appId);

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
  happWindow.loadFile(path.join(launcherFileSystem.appUiDir(appId), 'index.html'));
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
  ipcMain.handle('install-app', async (_e, filePath: string, appId: string) => {
    await HOLOCHAIN_MANAGER!.installApp(filePath, appId);
  });
  ipcMain.handle('uninstall-app', async (_e, appId: string) => {
    await HOLOCHAIN_MANAGER!.uninstallApp(appId);
  });
  ipcMain.handle('get-installed-apps', async () => {
    return HOLOCHAIN_MANAGER!.installedApps;
  });

  // Boot up lair and holochain
  const password = 'abc';
  // Initialize lair if necessary
  const lairHandleTemp = childProcess.spawnSync(lairBinary, ['--version']);
  if (!lairHandleTemp.stdout) {
    console.error(`Failed to run lair-keystore binary:\n${lairHandleTemp}`);
  }
  console.log(`Got lair version ${lairHandleTemp.stdout.toString()}`);
  if (!launcherFileSystem.keystoreInitialized()) {
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
  // launch lair keystore
  const [lairHandle, lairUrl] = await launchLairKeystore(
    lairBinary,
    launcherFileSystem.keystoreDir,
    launcherEmitter,
    password,
  );
  LAIR_HANDLE = lairHandle;
  // create zome call signer
  ZOME_CALL_SIGNER = await rustUtils.ZomeCallSigner.connect(lairUrl, password);
  // launch holochain
  const holochainManager = await HolochainManager.launch(
    launcherEmitter,
    launcherFileSystem,
    holochianBinaries['holochain-0.2.3-rc.1'],
    '0.2.3-rc.1',
    launcherFileSystem.holochainDir,
    launcherFileSystem.conductorConfigPath,
    lairUrl,
    'https://bootstrap.holo.host',
    'wss://signal.holo.host',
  );
  // ADMIN_PORT = holochainManager.adminPort;
  // ADMIN_WEBSOCKET = holochainManager.adminWebsocket;
  APP_PORT = holochainManager.appPort;
  HOLOCHAIN_MANAGER = holochainManager;

  // Install default apps if necessary:
  if (
    !HOLOCHAIN_MANAGER.installedApps.map((appInfo) => appInfo.installed_app_id).includes('KanDo')
  ) {
    console.log('Installing default app KanDo...');
    await HOLOCHAIN_MANAGER.installApp(path.join(DEFAULT_APPS_DIRECTORY, 'kando.webhapp'), 'KanDo');
    console.log('KanDo isntalled.');
  }

  createOrShowMainWindow();
  // console.log("creating happ window");
  // createHappWindow("hc-stress-test");
  // console.log("happ window created");
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

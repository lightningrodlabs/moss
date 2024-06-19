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
  Notification,
  systemPreferences,
} from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import * as childProcess from 'child_process';
import { createHash } from 'crypto';
import { Command, Option } from 'commander';
import { is } from '@electron-toolkit/utils';
import contextMenu from 'electron-context-menu';
import semver from 'semver';

import { AppAssetsInfo, DistributionInfo, WeFileSystem, deriveAppAssetsInfo } from './filesystem';
import { WeRustHandler } from '@lightningrodlabs/we-rust-utils';
// import { AdminWebsocket } from '@holochain/client';
import { SCREEN_OR_WINDOW_SELECTED, WeEmitter } from './weEmitter';
import { HolochainManager } from './holochainManager';
import { setupLogs } from './logs';
import { DEFAULT_APPS_DIRECTORY, ICONS_DIRECTORY } from './paths';
import { breakingVersion, emitToWindow, setLinkOpenHandlers, signZomeCall } from './utils';
import { createHappWindow } from './windows';
import { TOOLS_LIBRARY_APP_ID, AppHashes, ConductorInfo } from './sharedTypes';
import { nanoid } from 'nanoid';
import {
  APPLET_DEV_TMP_FOLDER_PREFIX,
  PRODUCTION_BOOTSTRAP_URLS,
  PRODUCTION_SIGNALING_URLS,
  validateArgs,
} from './cli/cli';
import { launch } from './launch';
import {
  AgentPubKeyB64,
  AppInfo,
  CallZomeRequest,
  InstalledAppId,
  encodeHashToBase64,
} from '@holochain/client';
import { v4 as uuidv4 } from 'uuid';
import { handleAppletProtocol, handleDefaultAppsProtocol } from './customSchemes';
import { AppletId, FrameNotification } from '@lightningrodlabs/we-applet';
import { readLocalServices, startLocalServices } from './cli/devSetup';
import { autoUpdater } from 'electron-updater';
import * as yaml from 'js-yaml';

const rustUtils = require('@lightningrodlabs/we-rust-utils');

let appVersion = app.getVersion();

console.log('process.argv: ', process.argv);

// Set as default protocol client for weave-0.12 deep links
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('weave-0.12', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('weave-0.12');
}

const ranViaCli = process.argv[3] && process.argv[3].endsWith('we-dev-cli');
if (ranViaCli) {
  process.argv.splice(2, 2);
  const cliPackageJsonPath = path.resolve(path.join(app.getAppPath(), '../../package.json'));
  const cliPackageJson = require(cliPackageJsonPath);
  appVersion = cliPackageJson.version;
}

const weCli = new Command();

weCli
  .name(ranViaCli ? '@lightningrodlabs/we-dev-cli' : 'Lightningrod Labs We')
  .description(
    ranViaCli ? 'Running We applets in development mode.' : 'Running We via the command line.',
  )
  .version(appVersion)
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
    '--dev-data-dir <path>',
    'Override the directory in which conductor data is stored in dev mode (default is a folder in the temp directory). Data in this directory will be cleaned up automatically.',
  )
  .option(
    '--holochain-path <path>',
    'Runs the Holochain Launcher with the holochain binary at the provided path. Use with caution since this may potentially corrupt your databases if the binary you use is not compatible with existing databases.',
  )
  .option('--holochain-rust-log <string>', 'RUST_LOG value to pass to the holochain binary')
  .option('--holochain-wasm-log <string>', 'WASM_LOG value to pass to the holochain binary')
  .option('--lair-rust-log <string>', 'RUST_LOG value to pass to the lair keystore binary')
  .option('-b, --bootstrap-url <url>', 'URL of the bootstrap server to use.')
  .option('-s, --signaling-url <url>', 'URL of the signaling server to use.')
  .option(
    '--force-production-urls',
    'Explicitly allow using the production URLs of bootstrap and/or singaling server during applet development. It is recommended to use hc-local-services to spin up a local bootstrap and signaling server instead during development.',
  )
  .option(
    '--print-holochain-logs',
    'Print holochain logs directly to the terminal (they will be still written to the logfile as well)',
  )
  .addOption(
    new Option(
      '--agent-idx <number>',
      'To be provided when running with the --dev-config option. Specifies which agent (as defined in the config file) to run We for. The agent with agentIdx 1 always needs to be run first.',
    ).argParser(parseInt),
  )
  .addOption(
    new Option(
      '--sync-time <number>',
      'May be provided when running with the --dev-config option. Specifies the amount of time to wait for new tools to gossip after having installed a new group before checking for unjoined tools.',
    ).argParser(parseInt),
  );

weCli.parse();

if (ranViaCli) {
  // In nix shell and on Windows SIGINT does not seem to be emitted so it is read from the command line instead.
  // https://stackoverflow.com/questions/10021373/what-is-the-windows-equivalent-of-process-onsigint-in-node-js
  const rl = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on('SIGINT', function () {
    process.emit('SIGINT');
  });

  process.on('SIGINT', () => {
    app.quit();
  });
}

const cliOpts = weCli.opts();

console.log('GOT WE CLI OPTIONS: ', cliOpts);

// If the app is being run via dev cli the --dev-config option is mandatory, otherwise We gets run with
// the userData location .config/Electron
if (ranViaCli) {
  cliOpts.devConfig = cliOpts.devConfig ? cliOpts.devConfig : 'we.dev.config.ts';
}

const RUN_OPTIONS = validateArgs(cliOpts);
// app.commandLine.appendSwitch('enable-logging');

const appName = app.getName();

if (process.env.NODE_ENV === 'development') {
  console.log('APP IS RUN IN DEVELOPMENT MODE');
  app.setName(appName + '-dev');
}

contextMenu({
  showSaveImageAs: true,
  showSearchWithGoogle: false,
  showInspectElement: true,
  append: (_defaultActions, _parameters, browserWindow) => [
    {
      label: 'Reload Moss',
      click: () => (browserWindow as BrowserWindow).reload(),
    },
  ],
});

console.log('APP PATH: ', app.getAppPath());
console.log('RUNNING ON PLATFORM: ', process.platform);

let CACHED_DEEP_LINK: string | undefined; // in case the application gets opened from scratch and the password needs to be entered first

if (app.isPackaged) {
  // Single instance and deep link logic
  // ------------------------------------------------------------------------------------------
  const isFirstInstance = app.requestSingleInstanceLock({ profile: RUN_OPTIONS.profile });

  if (!isFirstInstance && RUN_OPTIONS.profile === undefined) {
    app.quit();
  } else {
    // https://github.com/electron/electron/issues/40173
    if (process.platform !== 'darwin') {
      CACHED_DEEP_LINK = process.argv.find((arg) => arg.startsWith('weave-0.12://'));
    }

    app.on('second-instance', (_event, argv, _cwd, additionalData: any) => {
      // non-deeplink case (i.e. additionalData is defined)
      if (additionalData && additionalData.profile === RUN_OPTIONS.profile) {
        if (SPLASH_SCREEN_WINDOW) {
          SPLASH_SCREEN_WINDOW.show();
        } else {
          MAIN_WINDOW = createOrShowMainWindow();
        }
      } else if (additionalData && additionalData.profile !== RUN_OPTIONS.profile) {
        // If a second instance is being opened with a different profile
        return;
      } else if (process.platform !== 'darwin') {
        // deeplink case
        const url = argv.pop();
        if (MAIN_WINDOW) {
          // main window is already open
          createOrShowMainWindow();
          emitToWindow(MAIN_WINDOW, 'deep-link-received', url);
        } else {
          CACHED_DEEP_LINK = url;
        }
      }
    });

    if (process.platform === 'darwin') {
      app.on('open-url', (_event, url) => {
        if (MAIN_WINDOW) {
          createOrShowMainWindow();
          emitToWindow(MAIN_WINDOW, 'deep-link-received', url);
        } else {
          CACHED_DEEP_LINK = url;
        }
      });
    }
  }
}

// ------------------------------------------------------------------------------------------

if (RUN_OPTIONS.devInfo) {
  // garbage collect previously used folders
  const files = fs.readdirSync(RUN_OPTIONS.devInfo.tempDirRoot);
  const foldersToDelete = files.filter((file) =>
    file.startsWith(`${APPLET_DEV_TMP_FOLDER_PREFIX}-agent-${RUN_OPTIONS.devInfo!.agentIdx}`),
  );
  for (const folder of foldersToDelete) {
    fs.rmSync(path.join(RUN_OPTIONS.devInfo.tempDirRoot, folder), {
      recursive: true,
      force: true,
      maxRetries: 4,
    });
  }
}

const WE_FILE_SYSTEM = WeFileSystem.connect(
  app,
  RUN_OPTIONS.profile,
  RUN_OPTIONS.devInfo ? RUN_OPTIONS.devInfo.tempDir : undefined,
);

const APPLET_IFRAME_SCRIPT = fs.readFileSync(
  path.resolve(__dirname, '../applet-iframe/index.mjs'),
  'utf-8',
);

const WE_EMITTER = new WeEmitter();

setupLogs(WE_EMITTER, WE_FILE_SYSTEM, RUN_OPTIONS.printHolochainLogs);

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
let SELECT_SCREEN_OR_WINDOW_WINDOW: BrowserWindow | undefined | null;
let SYSTRAY_ICON_STATE: 'high' | 'medium' | undefined = undefined;
let SYSTRAY: Tray | undefined = undefined;
let isAppQuitting = false;
let LOCAL_SERVICES_HANDLE: childProcess.ChildProcessWithoutNullStreams | undefined;

// icons
const SYSTRAY_ICON_DEFAULT = nativeImage.createFromPath(path.join(ICONS_DIRECTORY, '32x32@2x.png'));
const SYSTRAY_ICON_HIGH = nativeImage.createFromPath(
  path.join(ICONS_DIRECTORY, 'icon_priority_high_32x32@2x.png'),
);
const SYSTRAY_ICON_MEDIUM = nativeImage.createFromPath(
  path.join(ICONS_DIRECTORY, 'icon_priority_medium_32x32@2x.png'),
);

const handleSignZomeCall = (_e: IpcMainInvokeEvent, zomeCall: CallZomeRequest) => {
  if (!WE_RUST_HANDLER) throw Error('Rust handler is not ready');
  if (MAIN_WINDOW)
    emitToWindow(MAIN_WINDOW, 'zome-call-signed', {
      cellIdB64: [
        encodeHashToBase64(new Uint8Array(zomeCall.cell_id[0])),
        encodeHashToBase64(new Uint8Array(zomeCall.cell_id[1])),
      ],
      fnName: zomeCall.fn_name,
      zomeName: zomeCall.zome_name,
    });
  return signZomeCall(zomeCall, WE_RUST_HANDLER);
};

const handleSignZomeCallApplet = (_e: IpcMainInvokeEvent, zomeCall: CallZomeRequest) => {
  if (!WE_RUST_HANDLER) throw Error('Rust handler is not ready');
  return signZomeCall(zomeCall, WE_RUST_HANDLER);
};

const createSplashscreenWindow = (): BrowserWindow => {
  const icon = nativeImage.createFromPath(path.join(ICONS_DIRECTORY, '../icon.png'));

  // Create the browser window.
  const splashWindow = new BrowserWindow({
    height: 450,
    width: 800,
    center: true,
    resizable: false,
    frame: false,
    show: false,
    backgroundColor: '#331ead',
    icon,
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

const createOrShowMainWindow = (): BrowserWindow => {
  if (MAIN_WINDOW) {
    MAIN_WINDOW.show();
    return MAIN_WINDOW;
  }

  // // Debugging for webRTC
  // let webRTCWindow = new BrowserWindow({
  //   width: 1200,
  //   height: 800,
  // });
  // webRTCWindow.loadURL('chrome://webrtc-internals');

  const icon = nativeImage.createFromPath(path.join(ICONS_DIRECTORY, '../icon.png'));

  // Create the browser window.
  let mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon,
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/admin.js'),
      // autoplayPolicy: 'user-gesture-required',
      // uncomment this line to get fetch requests working while testing publishing of tools:
      webSecurity: app.isPackaged ? true : false,
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
  if (!app.isPackaged || (app.isPackaged && !!RUN_OPTIONS.devInfo)) {
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

      const notificationIcon = nativeImage.createFromPath(
        path.join(ICONS_DIRECTORY, '128x128.png'),
      );

      new Notification({
        title: 'Moss keeps running in the background',
        body: 'To close Moss and stop synching with peers, Quit from the icon in the system tray.',
        icon: notificationIcon,
      })
        .on('click', async () => {
          createOrShowMainWindow();
          const response = await dialog.showMessageBox(MAIN_WINDOW!, {
            type: 'info',
            message:
              'Moss keeps running in the background if you close the Window.\n This is to keep synchronizing data with peers.\n\nDo you want to quit Moss fully?',
            buttons: ['Keep Running', 'Quit'],
            defaultId: 0,
            cancelId: 1,
          });
          if (response.response === 1) {
            app.quit();
          }
        })
        .show();
    }
  });
  mainWindow.on('closed', () => {
    // mainWindow = null;
    MAIN_WINDOW = null;
  });
  mainWindow.on('focus', () => {
    if (SYSTRAY) {
      SYSTRAY.setImage(SYSTRAY_ICON_DEFAULT);
      SYSTRAY_ICON_STATE = undefined;
    }
  });

  return mainWindow;
};

const selectScreenOrWindow = async (): Promise<string> => {
  if (SELECT_SCREEN_OR_WINDOW_WINDOW)
    throw new Error("Only one 'Select Screen or Window' window allowed at a time.");
  SELECT_SCREEN_OR_WINDOW_WINDOW = new BrowserWindow({
    height: 800,
    width: 1200,
    minimizable: false,
    autoHideMenuBar: true,
    title: 'Select Screen or Window',
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/selectmediasource.js'),
    },
  });
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    SELECT_SCREEN_OR_WINDOW_WINDOW.loadURL(
      `${process.env['ELECTRON_RENDERER_URL']}/selectmediasource.html`,
    );
  } else {
    SELECT_SCREEN_OR_WINDOW_WINDOW.loadFile(
      path.join(__dirname, '../renderer/selectmediasource.html'),
    );
  }
  return new Promise((resolve, reject) => {
    WE_EMITTER.on(SCREEN_OR_WINDOW_SELECTED, (id) => {
      if (SELECT_SCREEN_OR_WINDOW_WINDOW) {
        SELECT_SCREEN_OR_WINDOW_WINDOW.close();
        SELECT_SCREEN_OR_WINDOW_WINDOW = null;
      }
      return resolve(id as string);
    });
    SELECT_SCREEN_OR_WINDOW_WINDOW!.on('closed', () => {
      SELECT_SCREEN_OR_WINDOW_WINDOW = null;
      return reject('Selection canceled by user.');
    });
  });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  console.log('BEING RUN IN __dirnmane: ', __dirname);
  session.defaultSession.setPermissionRequestHandler(
    async (_webContents, permission, callback, details) => {
      if (permission === 'media') {
        const unknownRequested = !details.mediaTypes || details.mediaTypes.length === 0;
        const videoRequested = details.mediaTypes?.includes('video') || unknownRequested;
        const audioRequested = details.mediaTypes?.includes('audio') || unknownRequested;

        // On macOS, OS level permission for camera/microhone access needs to be given
        if (process.platform === 'darwin') {
          if (audioRequested) {
            const audioAccess = systemPreferences.getMediaAccessStatus('microphone');
            if (audioAccess === 'denied') {
              dialog.showMessageBoxSync(MAIN_WINDOW!, {
                type: 'error',
                message:
                  "Audio permission has been denied ealier. You need to allow audio for Moss in your Computer's System Preferences and restart Moss to allow audio.",
              });
              return;
            } else if (audioAccess !== 'granted') {
              const allowed = await systemPreferences.askForMediaAccess('microphone');
              if (!allowed) {
                dialog.showMessageBoxSync(MAIN_WINDOW!, {
                  type: 'error',
                  message:
                    "Audio permission has been denied. You need to allow audio for Moss in your Computer's System Preferences and restart Moss if you want to allow audio.",
                });
                return;
              }
            }
          }
          if (videoRequested) {
            const videoAccess = systemPreferences.getMediaAccessStatus('camera');
            if (videoAccess === 'denied') {
              dialog.showMessageBoxSync(MAIN_WINDOW!, {
                type: 'error',
                message:
                  "Video permission has been denied ealier. You need to allow video for Moss in your Computer's System Preferences and restart Moss to allow video.",
              });
              return;
            } else if (videoAccess !== 'granted') {
              const allowed = await systemPreferences.askForMediaAccess('camera');
              if (!allowed) {
                dialog.showMessageBoxSync(MAIN_WINDOW!, {
                  type: 'error',
                  message:
                    "Video permission has been denied. You need to allow video for Moss in your Computer's System Preferences and restart Moss if you want to allow video.",
                });
                return;
              }
            }
          }
        }

        let messageContent = `An Applet wants to access the following:${
          details.mediaTypes?.includes('video') ? '\n* camera' : ''
        }${details.mediaTypes?.includes('audio') ? '\n* microphone' : ''}`;
        if (unknownRequested) {
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
          return;
        }
      }
      if (permission === 'clipboard-sanitized-write') {
        callback(true);
        return;
      }
      callback(false);
    },
  );
  SYSTRAY = new Tray(SYSTRAY_ICON_DEFAULT);

  const notificationIcon = nativeImage.createFromPath(path.join(ICONS_DIRECTORY, '128x128.png'));

  handleAppletProtocol(WE_FILE_SYSTEM);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open',
      type: 'normal',
      click() {
        if (SPLASH_SCREEN_WINDOW) {
          SPLASH_SCREEN_WINDOW.show();
        } else {
          createOrShowMainWindow();
        }
      },
    },
    {
      label: 'Restart',
      type: 'normal',
      click() {
        const options: Electron.RelaunchOptions = {
          args: process.argv,
        };
        // https://github.com/electron-userland/electron-builder/issues/1727#issuecomment-769896927
        if (process.env.APPIMAGE) {
          console.log('process.execPath: ', process.execPath);
          options.args!.unshift('--appimage-extract-and-run');
          options.execPath = process.env.APPIMAGE;
        }
        app.relaunch(options);
        app.exit(0);
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

  SYSTRAY.setToolTip('Moss');
  SYSTRAY.setContextMenu(contextMenu);

  if (!RUN_OPTIONS.bootstrapUrl || !RUN_OPTIONS.signalingUrl) {
    // in dev mode
    if (RUN_OPTIONS.devInfo) {
      const [bootstrapUrl, signalingUrl, localServicesHandle] =
        RUN_OPTIONS.devInfo.agentIdx === 1 ? await startLocalServices() : await readLocalServices();
      RUN_OPTIONS.bootstrapUrl = RUN_OPTIONS.bootstrapUrl ? RUN_OPTIONS.bootstrapUrl : bootstrapUrl;
      RUN_OPTIONS.signalingUrl = RUN_OPTIONS.signalingUrl ? RUN_OPTIONS.signalingUrl : signalingUrl;
      LOCAL_SERVICES_HANDLE = localServicesHandle;
    } else {
      RUN_OPTIONS.bootstrapUrl = RUN_OPTIONS.bootstrapUrl
        ? RUN_OPTIONS.bootstrapUrl
        : PRODUCTION_BOOTSTRAP_URLS[0];
      RUN_OPTIONS.signalingUrl = RUN_OPTIONS.signalingUrl
        ? RUN_OPTIONS.signalingUrl
        : PRODUCTION_SIGNALING_URLS[0];
    }
  }

  console.log('RUN_OPTIONS on startup: ', RUN_OPTIONS);

  ipcMain.handle('exit', () => {
    app.exit(0);
  });
  ipcMain.handle('is-main-window-focused', (): boolean | undefined => MAIN_WINDOW?.isFocused());
  ipcMain.handle(
    'notification',
    (
      _e,
      notification: FrameNotification,
      showInSystray: boolean,
      notifyOS: boolean,
      appletId: AppletId | undefined,
      appletName: string | undefined,
    ): void => {
      if (showInSystray && notification.urgency === 'high') {
        SYSTRAY_ICON_STATE = 'high';
        SYSTRAY!.setImage(SYSTRAY_ICON_HIGH);
      } else if (
        showInSystray &&
        notification.urgency === 'medium' &&
        SYSTRAY_ICON_STATE !== 'high'
      ) {
        SYSTRAY_ICON_STATE = 'medium';
        SYSTRAY!.setImage(SYSTRAY_ICON_MEDIUM);
      }
      if (notifyOS) {
        new Notification({
          title: `${appletName}: ${notification.title}`,
          body: notification.body,
          icon: notificationIcon,
        })
          .on('click', () => {
            createOrShowMainWindow();
            emitToWindow(MAIN_WINDOW!, 'switch-to-applet', appletId);
            SYSTRAY_ICON_STATE = undefined;
            if (SYSTRAY) SYSTRAY.setImage(SYSTRAY_ICON_DEFAULT);
          })
          .show();
      }
    },
  );
  ipcMain.handle('get-app-version', (): string => app.getVersion());
  ipcMain.handle(
    'dialog-messagebox',
    async (_e, options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> => {
      if (MAIN_WINDOW) {
        return dialog.showMessageBox(MAIN_WINDOW, options);
      } else {
        return Promise.reject('Main window does not exist.');
      }
    },
  );
  ipcMain.handle('get-media-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
    return sources.map((source) => {
      return {
        name: source.name,
        id: source.id,
        thumbnail: source.thumbnail.toDataURL(),
        aspectRatio: source.thumbnail.getAspectRatio(),
      };
    });
  });
  ipcMain.handle('select-screen-or-window', async () => {
    if (SELECT_SCREEN_OR_WINDOW_WINDOW)
      return Promise.reject('Cannot select multiple screens/windows at once.');
    return selectScreenOrWindow();
  });
  ipcMain.handle('source-selected', (_e, id: string) => WE_EMITTER.emitScreenOrWindowSelected(id));
  ipcMain.handle('sign-zome-call', handleSignZomeCall);
  ipcMain.handle('sign-zome-call-applet', handleSignZomeCallApplet);
  ipcMain.handle(
    'open-app',
    async (_e, appId: string): Promise<void> =>
      createHappWindow(appId, WE_FILE_SYSTEM, HOLOCHAIN_MANAGER!.appPort),
  );
  ipcMain.handle(
    'install-app',
    async (_e, filePath: string, appId: string, networkSeed: string): Promise<void> => {
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
  ipcMain.handle('is-applet-dev', (_e): boolean => !!RUN_OPTIONS.devInfo);
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
  ipcMain.handle('get-applet-dev-port', (_e, appId: string): number | undefined => {
    const appAssetsInfo = WE_FILE_SYSTEM.readAppAssetsInfo(appId);
    if (appAssetsInfo.type === 'webhapp' && appAssetsInfo.ui.location.type === 'localhost') {
      return appAssetsInfo.ui.location.port;
    }
    return undefined;
  });
  ipcMain.handle('get-applet-iframe-script', (): string => {
    // TODO make sure we is in dev mode (e.g. not return iframe script if We is in production mode)
    return APPLET_IFRAME_SCRIPT;
  });
  ipcMain.handle('get-installed-apps', async (): Promise<Array<AppInfo>> => {
    return HOLOCHAIN_MANAGER!.installedApps;
  });
  ipcMain.handle('get-profile', (): string | undefined => RUN_OPTIONS.profile);
  ipcMain.handle('get-conductor-info', (): ConductorInfo => {
    return {
      app_port: HOLOCHAIN_MANAGER!.appPort,
      admin_port: HOLOCHAIN_MANAGER!.adminPort,
      tools_library_app_id: TOOLS_LIBRARY_APP_ID,
    };
  });
  ipcMain.handle('lair-setup-required', (): boolean => {
    return !WE_FILE_SYSTEM.keystoreInitialized();
  });
  ipcMain.handle('create-group', async (_e, withProgenitor: boolean): Promise<AppInfo> => {
    const apps = await HOLOCHAIN_MANAGER!.adminWebsocket.listApps({});
    const toolsLibraryAppInfo = apps.find(
      (appInfo) => appInfo.installed_app_id === TOOLS_LIBRARY_APP_ID,
    );
    if (!toolsLibraryAppInfo)
      throw new Error('Tools Library must be installed before installing the first group.');

    // generate random network seed
    const networkSeed = uuidv4();
    const hash = createHash('sha256');
    hash.update(networkSeed);
    const hashedSeed = hash.digest('base64');
    const appId = `group#${hashedSeed}#${withProgenitor ? encodeHashToBase64(toolsLibraryAppInfo.agent_pub_key) : null}`;
    console.log('Determined appId for group: ', appId);

    const groupHappPath = path.join(DEFAULT_APPS_DIRECTORY, 'group.happ');

    const dnaPropertiesMap = withProgenitor
      ? {
          group: yaml.dump({ progenitor: encodeHashToBase64(toolsLibraryAppInfo.agent_pub_key) }),
        }
      : {
          group: yaml.dump({
            progenitor: null,
          }),
        };

    console.log('Dna properties map: ', dnaPropertiesMap);
    const modifiedHappBytes = await rustUtils.happBytesWithCustomProperties(
      groupHappPath,
      dnaPropertiesMap,
    );

    const modifiedHappPath = path.join(os.tmpdir(), `group-happ-${nanoid(8)}.happ`);

    fs.writeFileSync(modifiedHappPath, new Uint8Array(modifiedHappBytes));

    const appInfo = await HOLOCHAIN_MANAGER!.adminWebsocket.installApp({
      path: modifiedHappPath,
      installed_app_id: appId,
      agent_key: toolsLibraryAppInfo.agent_pub_key,
      network_seed: networkSeed,
      membrane_proofs: {},
    });
    fs.rmSync(modifiedHappPath);
    await HOLOCHAIN_MANAGER!.adminWebsocket.enableApp({ installed_app_id: appId });
    return appInfo;
  });
  ipcMain.handle(
    'join-group',
    async (_e, networkSeed: string, progenitor: AgentPubKeyB64 | null): Promise<AppInfo> => {
      const apps = await HOLOCHAIN_MANAGER!.adminWebsocket.listApps({});
      const hash = createHash('sha256');
      hash.update(networkSeed);
      const hashedSeed = hash.digest('base64');
      const appId = `group#${hashedSeed}#${progenitor}`;
      console.log('Determined appId for group: ', appId);
      if (apps.map((appInfo) => appInfo.installed_app_id).includes(appId)) {
        await HOLOCHAIN_MANAGER!.adminWebsocket.enableApp({ installed_app_id: appId });
        const appInfo = apps.find((appInfo) => appInfo.installed_app_id === appId);
        if (!appInfo) throw new Error('AppInfo undefined.');
        return appInfo;
      }
      const toolsLibraryAppInfo = apps.find(
        (appInfo) => appInfo.installed_app_id === TOOLS_LIBRARY_APP_ID,
      );
      if (!toolsLibraryAppInfo)
        throw new Error('Tools Library must be installed before installing the first group.');

      console.log('got progenitor: ', progenitor);
      console.log('got networkSeed: ', networkSeed);
      const groupHappPath = path.join(DEFAULT_APPS_DIRECTORY, 'group.happ');
      const dnaPropertiesMap = {
        group: yaml.dump({ progenitor }),
      };

      console.log('Dna properties map: ', dnaPropertiesMap);
      const modifiedHappBytes = await rustUtils.happBytesWithCustomProperties(
        groupHappPath,
        dnaPropertiesMap,
      );

      const modifiedHappPath = path.join(os.tmpdir(), `group-happ-${nanoid(8)}.happ`);

      fs.writeFileSync(modifiedHappPath, new Uint8Array(modifiedHappBytes));
      const appInfo = await HOLOCHAIN_MANAGER!.adminWebsocket.installApp({
        path: modifiedHappPath,
        installed_app_id: appId,
        agent_key: toolsLibraryAppInfo.agent_pub_key,
        network_seed: networkSeed,
        membrane_proofs: {},
      });
      fs.rmSync(modifiedHappPath);
      await HOLOCHAIN_MANAGER!.adminWebsocket.enableApp({ installed_app_id: appId });
      return appInfo;
    },
  );
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
    ): Promise<void> => {
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
        try {
          // clean up
          fs.rmSync(tmpDir, { recursive: true });
        } catch (e) {}
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
  ipcMain.handle('uninstall-applet', async (_e, appId: string): Promise<void> => {
    await HOLOCHAIN_MANAGER!.adminWebsocket.uninstallApp({
      installed_app_id: appId,
    });
    WE_FILE_SYSTEM.deleteAppAssetsInfo(appId);
  });
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
    ): Promise<AppInfo> => {
      console.log('INSTALLING APPLET BUNDLE. metadata: ', metadata);
      const apps = await HOLOCHAIN_MANAGER!.adminWebsocket.listApps({});
      const alreadyInstalled = apps.find((appInfo) => appInfo.installed_app_id === appId);
      if (alreadyInstalled) {
        await HOLOCHAIN_MANAGER!.adminWebsocket.enableApp({ installed_app_id: appId });
        return alreadyInstalled;
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
        try {
          // clean up
          fs.rmSync(tmpDir, { recursive: true });
        } catch (e) {}
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
      WE_EMITTER,
      SPLASH_SCREEN_WINDOW,
      password,
      RUN_OPTIONS,
    );

    handleDefaultAppsProtocol(WE_FILE_SYSTEM, HOLOCHAIN_MANAGER);

    if (SPLASH_SCREEN_WINDOW) SPLASH_SCREEN_WINDOW.close();
    SPLASH_SCREEN_WINDOW = undefined;
    MAIN_WINDOW = createOrShowMainWindow();
    // Send cached deep link to main window after a timeout to make sure the event listener is ready
    if (CACHED_DEEP_LINK) {
      setTimeout(() => {
        if (MAIN_WINDOW) {
          emitToWindow(MAIN_WINDOW, 'deep-link-received', CACHED_DEEP_LINK);
        }
      }, 1000);
    }
  });

  if (RUN_OPTIONS.devInfo) {
    [LAIR_HANDLE, HOLOCHAIN_MANAGER, WE_RUST_HANDLER] = await launch(
      WE_FILE_SYSTEM,
      WE_EMITTER,
      undefined,
      'dummy-dev-password :)',
      RUN_OPTIONS,
    );
    MAIN_WINDOW = createOrShowMainWindow();
  } else {
    SPLASH_SCREEN_WINDOW = createSplashscreenWindow();

    // Check for updates
    if (app.isPackaged) {
      autoUpdater.allowPrerelease = true;
      autoUpdater.autoDownload = false;

      let updateCheckResult;

      try {
        updateCheckResult = await autoUpdater.checkForUpdates();
      } catch (e) {
        console.warn('Failed to check for updates: ', e);
      }

      console.log('updateCheckResult: ', updateCheckResult);

      // We only install semver compatible updates
      if (
        updateCheckResult &&
        breakingVersion(updateCheckResult.updateInfo.version) === breakingVersion(appVersion) &&
        semver.gt(updateCheckResult.updateInfo.version, appVersion)
      ) {
        const userDecision = await dialog.showMessageBox({
          title: 'Update Available',
          type: 'question',
          buttons: ['Deny', 'Install and Restart'],
          defaultId: 1,
          cancelId: 0,
          message: `A new compatible version of Moss is available (${updateCheckResult.updateInfo.version}). Do you want to install it? You will need to restart Moss for the Update to take effect.\n\nRelease notes can be found at:\nhttps://github.com/lightningrodlabs/we/releases/v${updateCheckResult.updateInfo.version}`,
        });
        if (userDecision.response === 1) {
          // downloading means that with the next start of the application it's automatically going to be installed
          autoUpdater.on('update-downloaded', () => autoUpdater.quitAndInstall());
          await autoUpdater.downloadUpdate();

          // let options: Electron.RelaunchOptions = {
          //   args: process.argv,
          // };
          // // https://github.com/electron-userland/electron-builder/issues/1727#issuecomment-769896927
          // if (process.env.APPIMAGE) {
          //   options.args!.unshift('--appimage-extract-and-run');
          //   options.execPath = process.env.APPIMAGE.replace(
          //     appVersion,
          //     updateCheckResult.updateInfo.version,
          //   );
          // }
          // app.relaunch(options);
          // app.exit(0);
        }
      }
    }
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
    MAIN_WINDOW = createOrShowMainWindow();
  }
});

app.on('before-quit', () => {
  isAppQuitting = true;
});

app.on('quit', () => {
  if (fs.existsSync('.hc_local_services')) {
    fs.rmSync('.hc_local_services');
  }
  if (LAIR_HANDLE) {
    LAIR_HANDLE.kill();
  }
  if (HOLOCHAIN_MANAGER) {
    HOLOCHAIN_MANAGER.processHandle.kill();
  }
  if (LOCAL_SERVICES_HANDLE) {
    LOCAL_SERVICES_HANDLE.kill();
  }
});

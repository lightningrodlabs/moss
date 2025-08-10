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
  MediaAccessPermissionRequest,
} from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import url from 'url';
import mime from 'mime';
import * as childProcess from 'child_process';
import { createHash } from 'crypto';
import { program, Command, Option } from 'commander';
import { is } from '@electron-toolkit/utils';
import contextMenu from 'electron-context-menu';
import semver from 'semver';

import { MossFileSystem, deriveAppAssetsInfo } from './filesystem';
// import { AdminWebsocket } from '@holochain/client';
import { SCREEN_OR_WINDOW_SELECTED, WeEmitter } from './weEmitter';
import { HolochainManager } from './holochainManager';
import { setupLogs } from './logs';
import { DEFAULT_APPS_DIRECTORY, ICONS_DIRECTORY } from './paths';
import {
  breakingVersion,
  emitToWindow,
  logIf,
  readIcon,
  retryNTimes,
  setLinkOpenHandlers,
  signZomeCall,
} from './utils';
import { createWalWindow } from './windows';
import { ConductorInfo, ToolWeaveConfig } from './sharedTypes';
import {
  AppAssetsInfo,
  AppHashes,
  DeveloperCollectiveToolList,
  DistributionInfo,
  ResourceLocation,
  ToolCompatibilityId,
  ToolInfoAndVersions,
  WeaveDevConfig,
} from '@theweave/moss-types';
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
  DnaHashB64,
  InstalledAppId,
  encodeHashToBase64,
} from '@holochain/client';
import { v4 as uuidv4 } from 'uuid';
import { handleAppletProtocol, handleCrossGroupProtocol } from './customSchemes';
import {
  AppletId,
  AppletToParentMessage,
  FrameNotification,
  GroupProfile,
  ParentToAppletMessage,
  WAL,
  WeaveLocation,
} from '@theweave/api';
import { readLocalServices, startLocalServices } from './cli/devSetup';
import { autoUpdater, UpdateCheckResult } from '@matthme/electron-updater';
import { mossMenu } from './menu';
import { type WeRustHandler } from '@lightningrodlabs/we-rust-utils';
import {
  appletIdFromAppId,
  globalPubKeyFromListAppsResponse,
  toolCompatibilityIdFromDistInfo,
  toOriginalCaseB64,
} from '@theweave/utils';
import { Jimp } from 'jimp';

const rustUtils = require('@lightningrodlabs/we-rust-utils');

let appVersion = app.getVersion();

// console.log('process.argv: ', process.argv);

// Set as default protocol client for weave-0.14 deep links
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('weave-0.14', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('weave-0.14');
}

const ranViaCli = process.argv[3] && process.argv[3].endsWith('weave');
if (ranViaCli) {
  process.argv.splice(2, 2);
  const cliPackageJsonPath = path.resolve(path.join(app.getAppPath(), '../../package.json'));
  const cliPackageJson = require(cliPackageJsonPath);
  appVersion = cliPackageJson.version;
}

let RUNNING_WITH_COMMAND = true;

// CLI command to compute the sha256 of a webhapp
const hashWebhapp = new Command();
hashWebhapp
  .name('hash-webhapp')
  .description('Compute the sha256 hashes of the webhapp and its contents')
  .argument('<pathOrUrl>')
  .action(async (pathOrUrl) => {
    if (pathOrUrl.startsWith('https://')) {
      const webhapp = await fetch(pathOrUrl);
      const appHashes = await rustUtils.validateHappOrWebhapp(
        Array.from(new Uint8Array(await webhapp.arrayBuffer())),
      );
      console.log(JSON.stringify(appHashes, undefined, 4));
    } else {
      const webhapp = fs.readFileSync(pathOrUrl);
      const appHashes = await rustUtils.validateHappOrWebhapp(Array.from(webhapp));
      console.log(JSON.stringify(appHashes, undefined, 4));
    }
    app.quit();
  });

program
  .name(ranViaCli ? '@theweave/cli' : 'Moss')
  .description(
    ranViaCli ? 'Running Moss Tools in development mode.' : 'Running Moss via the command line.',
  )
  .version(appVersion)
  .action(() => {
    RUNNING_WITH_COMMAND = false;
  }) // This just needs to be here for the program to run also if no command is provided
  .option(
    '-p, --profile <string>',
    'Runs Moss with a custom profile with its own dedicated data store.',
  )
  .option(
    '-n, --network-seed <string>',
    'Installs any default apps with the provided network seed in case there are any and have not yet been installed.',
  )
  .option(
    '-c, --dev-config <path>',
    'Runs Moss in Tool developer mode based on the configuration file at the specified path.',
  )
  .option(
    '--dev-data-dir <path>',
    'Override the directory in which conductor data is stored in dev mode (default is a folder in the temp directory). Data in this directory will be cleaned up automatically.',
  )
  .option(
    '--holochain-path <path>',
    'Runs Moss with the holochain binary at the provided path. Use with caution since this may potentially corrupt your databases if the binary you use is not compatible with existing databases.',
  )
  .option('--holochain-rust-log <string>', 'RUST_LOG value to pass to the holochain binary')
  .option('--holochain-wasm-log <string>', 'WASM_LOG value to pass to the holochain binary')
  .option('--lair-rust-log <string>', 'RUST_LOG value to pass to the lair keystore binary')
  .option(
    '-b, --bootstrap-url <url>',
    'URL of the bootstrap server to use (not persisted across restarts).',
  )
  .option(
    '-s, --signaling-url <url>',
    'URL of the signaling server to use (not persisted across restarts).',
  )
  .option(
    '--ice-urls <string>',
    'Comma separated string of ICE server URLs to use. Is ignored if an external holochain binary is being used (not persisted across restarts).',
  )
  .option(
    '--force-production-urls',
    'Explicitly allow using the production URLs of bootstrap and/or singaling server during applet development. It is recommended to use kitsune2-bootstrap-srv to spin up a local bootstrap and signaling server instead during development.',
  )
  .option(
    '--print-holochain-logs',
    'Print holochain logs directly to the terminal (they will be still written to the logfile as well)',
  )
  .option('--disable-os-notifications', 'Disables all notifications to the Operating System')
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
  )
  .addCommand(hashWebhapp);

program.parseAsync();

console.log('ELECTRON VERSION: ', process.versions.electron);

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

if (!RUNNING_WITH_COMMAND) {
  const cliOpts = program.opts();

  logIf(!RUNNING_WITH_COMMAND, 'GOT WE CLI OPTIONS: ', cliOpts);

  // If the app is being run via dev cli the --dev-config option is mandatory, otherwise Moss gets run with
  // the userData location .config/Electron
  if (ranViaCli) {
    cliOpts.devConfig = cliOpts.devConfig ? cliOpts.devConfig : 'weave.dev.config.ts';
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

  logIf(!RUNNING_WITH_COMMAND, 'APP PATH: ', app.getAppPath());
  logIf(!RUNNING_WITH_COMMAND, 'RUNNING ON PLATFORM: ', process.platform);

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
        CACHED_DEEP_LINK = process.argv.find((arg) => arg.startsWith('weave-0.14://'));
      }

      // This event will always be triggered in the first instance, no matter with which profile
      // it is being run. On Linux and Windows it is also how deeplinks get in.
      app.on('second-instance', (_event, argv, _cwd, additionalData: any) => {
        if (!isAppQuitting) {
          console.log('second-instance event triggered. argv: ', argv);
          console.log('additionalData: ', additionalData);
          if (process.platform !== 'darwin') {
            console.log('Option 3');

            // deeplink case
            const url = argv.pop();
            if (SPLASH_SCREEN_WINDOW) {
              CACHED_DEEP_LINK = url;
              SPLASH_SCREEN_WINDOW.show();
            } else if (MAIN_WINDOW) {
              console.log('RECEIVED DEEP LINK: url', argv, url);
              // main window is already open
              createOrShowMainWindow();
              emitToWindow(MAIN_WINDOW, 'deep-link-received', url);
            } else {
              CACHED_DEEP_LINK = url;
            }
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

  const WE_FILE_SYSTEM = MossFileSystem.connect(
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
      scheme: 'applet',
      privileges: { standard: true, supportFetchAPI: true, secure: true, stream: true },
    },
    {
      scheme: 'cross-group',
      privileges: { standard: true, supportFetchAPI: true, secure: true, stream: true },
    },
    {
      scheme: 'moss',
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
      },
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
  const WAL_WINDOWS: Record<
    string,
    {
      appletId: AppletId;
      window: BrowserWindow;
      wal: WAL;
    }
  > = {};
  let UPDATE_AVAILABLE:
    | {
        version: string;
        releaseDate: string;
        releaseNotes: string | undefined;
      }
    | undefined;

  // icons
  const SYSTRAY_ICON_DEFAULT = nativeImage.createFromPath(
    path.join(ICONS_DIRECTORY, 'icon_systray_32x32@2x.png'),
  );
  const SYSTRAY_ICON_QUITTING = nativeImage.createFromPath(
    path.join(ICONS_DIRECTORY, 'transparent32x32@2x.png'),
  );

  const SYSTRAY_ICON_HIGH = nativeImage.createFromPath(
    path.join(ICONS_DIRECTORY, 'icon_priority_high_32x32@2x.png'),
  );
  const SYSTRAY_ICON_MEDIUM = nativeImage.createFromPath(
    path.join(ICONS_DIRECTORY, 'icon_priority_medium_32x32@2x.png'),
  );

  const handleSignZomeCall = (_e: IpcMainInvokeEvent, zomeCall: CallZomeRequest) => {
    if (!WE_RUST_HANDLER) throw Error('Rust handler is not ready');
    return signZomeCall(zomeCall, WE_RUST_HANDLER);
  };

  const handleSignZomeCallApplet = (_e: IpcMainInvokeEvent, zomeCall: CallZomeRequest) => {
    if (!WE_RUST_HANDLER) throw Error('Rust handler is not ready');
    return signZomeCall(zomeCall, WE_RUST_HANDLER);
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
        // webSecurity: app.isPackaged ? true : false,
        safeDialogs: true,
        // Otherwise polling zome calls will stop working properly
        backgroundThrottling: false,
      },
      show: false,
    });

    console.log('Creating main window');

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    } else {
      mainWindow.loadURL('moss://admin.renderer/index.html');
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
      console.log('OPENING DEV TOOLS');
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
        safeDialogs: true,
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

  Menu.setApplicationMenu(mossMenu(WE_FILE_SYSTEM, () => MAIN_WINDOW));

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.whenReady().then(async () => {
    console.log('BEING RUN IN __dirnmane: ', __dirname);

    session.defaultSession.protocol.handle('moss', (request) => {
      const uriWithoutProtocol = request.url.slice('moss://'.length);
      const filePathComponents = uriWithoutProtocol.split('/').slice(1);
      const filePath = path.join(...filePathComponents);
      const absolutePath = path.join(__dirname, '..', 'renderer', filePath);
      return net.fetch(url.pathToFileURL(absolutePath).toString());
    });

    session.defaultSession.setPermissionRequestHandler(
      async (webContents, permission, callback, details) => {
        if (permission === 'media') {
          const unknownRequested =
            !(details as MediaAccessPermissionRequest).mediaTypes ||
            (details as MediaAccessPermissionRequest).mediaTypes?.length === 0;
          const videoRequested =
            (details as MediaAccessPermissionRequest).mediaTypes?.includes('video') ||
            unknownRequested;
          const audioRequested =
            (details as MediaAccessPermissionRequest).mediaTypes?.includes('audio') ||
            unknownRequested;

          console.log(
            '@permissionRequestHandler: details.mediaTypes: ',
            (details as MediaAccessPermissionRequest).mediaTypes,
          );

          let requestingWindow: BrowserWindow | undefined;
          if (MAIN_WINDOW && webContents.id === MAIN_WINDOW.webContents.id) {
            requestingWindow = MAIN_WINDOW;
          } else {
            const windowAndInfo = Object.values(WAL_WINDOWS).find(
              (info) => info.window.webContents.id === webContents.id,
            );
            if (windowAndInfo) {
              requestingWindow = windowAndInfo.window;
            }
          }

          if (!requestingWindow)
            throw Error('The requesting window is not allowed to request media access.');

          // If it's coming from a Tool, figure out the toolId (originalToolActionHash)
          let toolId: string | undefined;
          if (details.requestingUrl.startsWith('applet://')) {
            const appletAppId = `applet#${details.requestingUrl.slice(9).split('/')[0]}`;
            console.log('appletAppId: ', appletAppId);
            try {
              const assetInfo = WE_FILE_SYSTEM.readAppAssetsInfo(appletAppId);
              console.log('assetInfo: ', assetInfo);
              if (assetInfo.distributionInfo.type === 'web2-tool-list') {
                toolId = assetInfo.distributionInfo.info.toolCompatibilityId;
              }
            } catch (e) {
              console.warn('Failed to read assetInfo during permission request.');
            }
          } else if (details.requestingUrl.startsWith('cross-group://')) {
            toolId = toOriginalCaseB64(details.requestingUrl.slice(14).split('/')[0]);
            console.log('@permissionRequestHandler: GOT TOOLID for cross-group iframe: ', toolId);
          }

          // On macOS, OS level permission for camera/microhone access needs to be given
          if (process.platform === 'darwin') {
            if (audioRequested) {
              const audioAccess = systemPreferences.getMediaAccessStatus('microphone');
              if (audioAccess === 'denied') {
                dialog.showMessageBoxSync(requestingWindow, {
                  type: 'error',
                  message:
                    "Audio permission has been denied ealier. You need to allow audio for Moss in your Computer's System Preferences and restart Moss to allow audio.",
                });
                return;
              } else if (audioAccess !== 'granted') {
                const allowed = await systemPreferences.askForMediaAccess('microphone');
                if (!allowed) {
                  dialog.showMessageBoxSync(requestingWindow, {
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
                dialog.showMessageBoxSync(requestingWindow, {
                  type: 'error',
                  message:
                    "Video permission has been denied ealier. You need to allow video for Moss in your Computer's System Preferences and restart Moss to allow video.",
                });
                return;
              } else if (videoAccess !== 'granted') {
                const allowed = await systemPreferences.askForMediaAccess('camera');
                if (!allowed) {
                  dialog.showMessageBoxSync(requestingWindow, {
                    type: 'error',
                    message:
                      "Video permission has been denied. You need to allow video for Moss in your Computer's System Preferences and restart Moss if you want to allow video.",
                  });
                  return;
                }
              }
            }
          }

          // Check existing settings and only show dialog if necessary
          if (toolId) {
            const toolPreferences = WE_FILE_SYSTEM.toolUserPreferences(toolId);
            if (toolPreferences) {
              // If full media access is already granted, allow permission and return
              if (toolPreferences.fullMediaAccessGranted) {
                callback(true);
                return;
              } else {
                if (!unknownRequested) {
                  if (
                    audioRequested &&
                    videoRequested &&
                    toolPreferences.microphoneAccessGranted &&
                    toolPreferences.cameraAccessGranted
                  ) {
                    callback(true);
                    return;
                  }
                  if (audioRequested && toolPreferences.microphoneAccessGranted) {
                    callback(true);
                    return;
                  }
                  if (videoRequested && toolPreferences.cameraAccessGranted) {
                    callback(true);
                    return;
                  }
                }
              }
            }
          }

          let messageContent = `A Tool wants to access the following:${
            (details as MediaAccessPermissionRequest).mediaTypes?.includes('video')
              ? '\n* camera'
              : ''
          }${(details as MediaAccessPermissionRequest).mediaTypes?.includes('audio') ? '\n* microphone' : ''}`;
          if (unknownRequested) {
            messageContent =
              'A Tool wants to access either or all of the following:\n* camera\n* microphone\n* screen share';
          }

          const response = await dialog.showMessageBox(requestingWindow, {
            type: 'question',
            buttons: ['Deny', 'Allow'],
            defaultId: 0,
            cancelId: 0,
            message: messageContent,
            checkboxLabel: toolId ? 'Remember my decision for this Tool' : undefined,
          });
          if (response.response === 1) {
            callback(true);
            if (toolId && response.checkboxChecked) {
              if (videoRequested) {
                WE_FILE_SYSTEM.grantCameraAccess(toolId);
              }
              if (audioRequested) {
                WE_FILE_SYSTEM.grantMicrophoneAccess(toolId);
              }
              if (unknownRequested) {
                WE_FILE_SYSTEM.grantFullMediaAccess(toolId);
              }
            }
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
    SYSTRAY.setToolTip('Moss (0.14)');

    const notificationIcon = nativeImage.createFromPath(path.join(ICONS_DIRECTORY, '128x128.png'));

    handleAppletProtocol(WE_FILE_SYSTEM);
    handleCrossGroupProtocol(WE_FILE_SYSTEM);

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
          app.quit();
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

    SYSTRAY.setContextMenu(contextMenu);

    if (!RUN_OPTIONS.bootstrapUrl || !RUN_OPTIONS.signalingUrl) {
      // in dev mode
      if (RUN_OPTIONS.devInfo) {
        const [bootstrapUrl, signalingUrl, localServicesHandle] =
          RUN_OPTIONS.devInfo.agentIdx === 1
            ? await startLocalServices()
            : await readLocalServices();
        RUN_OPTIONS.bootstrapUrl = RUN_OPTIONS.bootstrapUrl
          ? RUN_OPTIONS.bootstrapUrl
          : bootstrapUrl;
        RUN_OPTIONS.signalingUrl = RUN_OPTIONS.signalingUrl
          ? RUN_OPTIONS.signalingUrl
          : signalingUrl;
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

    registerIPCHandlers(notificationIcon);

    console.log('RUN_OPTIONS on startup: ', RUN_OPTIONS);

    MAIN_WINDOW = createOrShowMainWindow();

    // Check for updates
    if (app.isPackaged) {
      autoUpdater.allowPrerelease = true;
      autoUpdater.autoDownload = false;

      let updateCheckResult: UpdateCheckResult | null | undefined;

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
        UPDATE_AVAILABLE = {
          version: updateCheckResult.updateInfo.version,
          releaseDate: updateCheckResult.updateInfo.releaseDate,
          releaseNotes: updateCheckResult.updateInfo.releaseNotes as string | undefined,
        };
      }
    }
  });

  /**
   * -------------------------------------------------------
   * IPC HANDLERS
   * -------------------------------------------------------
   */

  function registerIPCHandlers(notificationIcon: Electron.NativeImage) {
    ipcMain.handle('exit', () => {
      app.exit(0);
    });
    ipcMain.handle('open-logs', async () => WE_FILE_SYSTEM.openLogs());
    ipcMain.handle('export-logs', async () => WE_FILE_SYSTEM.exportLogs());
    ipcMain.handle('factory-reset', async () => {
      const userDecision = await dialog.showMessageBox({
        title: 'Factory Reset',
        type: 'warning',
        buttons: ['Cancel', 'Confirm'],
        defaultId: 0,
        cancelId: 0,
        message: `Are you sure you want to fully reset Moss? This will delete all your Moss related data.`,
      });
      if (userDecision.response === 1) {
        // Close all windows
        if (MAIN_WINDOW) MAIN_WINDOW.close();
        if (SPLASH_SCREEN_WINDOW) SPLASH_SCREEN_WINDOW.close();
        for (const window of Object.values(WAL_WINDOWS)) {
          window.window.close();
        }
        // Kill holochain and lair
        if (LAIR_HANDLE) LAIR_HANDLE.kill();
        if (HOLOCHAIN_MANAGER) HOLOCHAIN_MANAGER.processHandle.kill();
        // Remove all data
        await WE_FILE_SYSTEM.factoryReset();
        // restart Moss
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
        app.quit();
      }
    }),
      ipcMain.handle('is-main-window-focused', (): boolean | undefined => MAIN_WINDOW?.isFocused());
    ipcMain.handle(
      'notification',
      (
        _e,
        notification: FrameNotification,
        showInSystray: boolean,
        notifyOS: boolean,
        weaveLocation: WeaveLocation | undefined,
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
        if (notifyOS && !RUN_OPTIONS.disableOsNotifications) {
          new Notification({
            title: `${appletName}: ${notification.title}`,
            body: notification.body,
            icon: notificationIcon,
          })
            .on('click', () => {
              console.log('Clicked on OS notification');
              createOrShowMainWindow();
              if (weaveLocation)
                emitToWindow(MAIN_WINDOW!, 'switch-to-weave-location', weaveLocation);
              SYSTRAY_ICON_STATE = undefined;
              if (SYSTRAY) SYSTRAY.setImage(SYSTRAY_ICON_DEFAULT);
            })
            .show();
        }
      },
    );
    // Forward the message to the main window with a unique nano id and waits for the response
    // that should get sent via IPC ('applet-message-to-parent-response')
    ipcMain.handle('applet-message-to-parent', (_e, message: AppletToParentMessage) => {
      if (!MAIN_WINDOW) throw new Error('Main window does not exists.');
      const messageId = nanoid(5);
      if (message.request.type === 'open-view') {
        MAIN_WINDOW.show();
      }
      emitToWindow(MAIN_WINDOW!, 'applet-to-parent-message', {
        message,
        id: messageId,
      });
      return new Promise((resolve, reject) => {
        const timeoutMs = 60000;
        const timeout = setTimeout(() => {
          return reject(`Cross-window AppletToParentRequest timed out in ${timeoutMs}ms`);
        }, timeoutMs);
        WE_EMITTER.on(messageId, (response) => {
          clearTimeout(timeout);
          return resolve(response);
        });
      });
    });
    ipcMain.handle('applet-message-to-parent-response', (_e, response: any, id: string) => {
      WE_EMITTER.emit(id, response);
    });
    ipcMain.handle(
      'parent-to-applet-message',
      (_e, message: ParentToAppletMessage, forApplets: AppletId[]) => {
        // We send this to all wal windows as they may also contain embeddables
        Object.values(WAL_WINDOWS).forEach(({ window }) =>
          emitToWindow(window, 'parent-to-applet-message', { message, forApplets }),
        );
      },
    );
    // This is called by the main window if it's being reloaded, in order to re-sync the
    // IframeStore
    ipcMain.handle('request-iframe-store-sync', (): void => {
      Object.values(WAL_WINDOWS).forEach(({ window }) =>
        emitToWindow(window, 'request-iframe-store-sync', null),
      );
    });
    // Called by WAL windows to send their IframeStore state to the main window
    ipcMain.handle('iframe-store-sync', (_e, storeContent): void => {
      if (MAIN_WINDOW) emitToWindow(MAIN_WINDOW, 'iframe-store-sync', storeContent);
    });
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
    ipcMain.handle('source-selected', (_e, id: string) =>
      WE_EMITTER.emitScreenOrWindowSelected(id),
    );
    ipcMain.handle('sign-zome-call', handleSignZomeCall);
    ipcMain.handle('sign-zome-call-applet', handleSignZomeCallApplet);
    ipcMain.handle('open-wal-window', (_e, src: string, appletId: AppletId, wal: WAL) => {
      const maybeExistingWindowInfo = WAL_WINDOWS[src];
      if (maybeExistingWindowInfo) {
        maybeExistingWindowInfo.window.show();
        return;
      }
      const newWalWindow = createWalWindow();
      // on-before-unload (added here for searchability of event-related code)
      // This event is forwarded to the window in order to discern in the
      // onbeforeunload callback between reloading and closing of the window
      newWalWindow.on('close', () => {
        // on-before-unload
        // closing may be prevented by the beforeunload event listener in the window
        // the first time. The window should however be hidden already anyway.
        newWalWindow.hide();
        emitToWindow(newWalWindow, 'window-closing', null);
      });
      newWalWindow.on('closed', () => {
        delete WAL_WINDOWS[src];
      });
      WAL_WINDOWS[src] = {
        window: newWalWindow,
        appletId,
        wal,
      };
    });
    // To be called by WAL windows to find out which src the iframe is supposed to use
    ipcMain.handle(
      'get-my-src',
      (e): { iframeSrc: string; appletId: AppletId; wal: WAL } | undefined => {
        console.log();
        const walAndWindowInfo = Object.entries(WAL_WINDOWS).find(
          ([_src, window]) => window.window.webContents.id === e.sender.id,
        );
        if (walAndWindowInfo)
          return {
            iframeSrc: walAndWindowInfo[0],
            appletId: walAndWindowInfo[1].appletId,
            wal: walAndWindowInfo[1].wal,
          };
        return undefined;
      },
    );
    ipcMain.handle('close-main-window', () => {
      if (MAIN_WINDOW) MAIN_WINDOW.close();
    });
    ipcMain.handle('close-window', (e) => {
      const walAndWindowInfo = Object.entries(WAL_WINDOWS).find(
        ([_src, window]) => window.window.webContents.id === e.sender.id,
      );
      if (walAndWindowInfo) {
        walAndWindowInfo[1].window.close();
      }
    });
    ipcMain.handle('focus-main-window', (): void => {
      if (MAIN_WINDOW) MAIN_WINDOW.show();
    });
    ipcMain.handle('focus-my-window', (e): void => {
      const windowAndInfo = Object.entries(WAL_WINDOWS).find(
        ([_src, window]) => window.window.webContents.id === e.sender.id,
      );
      if (windowAndInfo) windowAndInfo[1].window.show();
    });
    ipcMain.handle('set-my-title', (e, title: string) => {
      const windowAndInfo = Object.entries(WAL_WINDOWS).find(
        ([_src, window]) => window.window.webContents.id === e.sender.id,
      );
      if (windowAndInfo) {
        const window = windowAndInfo[1].window;
        window.setTitle(title);
      }
    });
    ipcMain.handle('set-my-icon', (e, icon: string) => {
      const windowAndInfo = Object.entries(WAL_WINDOWS).find(
        ([_src, window]) => window.window.webContents.id === e.sender.id,
      );
      if (windowAndInfo) {
        const nativeIcon = nativeImage.createFromDataURL(icon);
        const window = windowAndInfo[1].window;
        window.setIcon(nativeIcon);
      }
    });
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
      'applet-dev-config',
      (_e): WeaveDevConfig | undefined => RUN_OPTIONS.devInfo?.config,
    );
    ipcMain.handle(
      'get-all-app-assets-infos',
      async (): Promise<Record<InstalledAppId, [AppAssetsInfo, ToolWeaveConfig | undefined]>> => {
        const allAppAssetsInfos: Record<
          InstalledAppId,
          [AppAssetsInfo, ToolWeaveConfig | undefined]
        > = {};
        // Get all applets
        const allApps = await HOLOCHAIN_MANAGER!.adminWebsocket.listApps({});
        const allApplets = allApps.filter((appInfo) =>
          appInfo.installed_app_id.startsWith('applet#'),
        );
        // For each applet, read app assets info and weave config and add to record
        await Promise.all(
          allApplets.map(async (appInfo) => {
            try {
              const appAssetsInfo = WE_FILE_SYSTEM.readAppAssetsInfo(appInfo.installed_app_id);
              let toolWeaveConfig;
              const uiAssetsDir = WE_FILE_SYSTEM.appUiAssetsDir(appInfo.installed_app_id);
              if (uiAssetsDir) {
                try {
                  const weaveConfigString = fs.readFileSync(
                    path.join(uiAssetsDir, 'weave.config.json'),
                    'utf-8',
                  );
                  toolWeaveConfig = JSON.parse(weaveConfigString);
                } catch (e) {
                  // console.error('Failed to get weaveConfig: ', e);
                  // invalid or inexistent weave config - ignore
                }
              } else if (
                appAssetsInfo.type === 'webhapp' &&
                appAssetsInfo.ui.location.type === 'localhost'
              ) {
                // We want this to time out because it seems to never return sometimes
                const controller = new AbortController();
                const id = setTimeout(() => controller.abort(), 2000);
                try {
                  // console.log('Trying to fetch weave.config.json from localhost');
                  const resp = await net.fetch(
                    `http://localhost:${appAssetsInfo.ui.location.port}/weave.config.json`,
                    { signal: controller.signal },
                  );
                  clearTimeout(id);
                  toolWeaveConfig = await resp.json();
                } catch (e: any) {
                  clearTimeout(id);
                  if (e.name && e.name === 'AbortError') {
                    console.error(
                      `Fetch request for AssetInfo from localhost on port ${appAssetsInfo.ui.location.port} timed out after 2000ms.`,
                    );
                  }
                  // invalid or inexistent weave config - ignore
                }
              }
              allAppAssetsInfos[appInfo.installed_app_id] = [appAssetsInfo, toolWeaveConfig];
            } catch (e) {
              console.warn(
                `Failed to read AppAssetsInfo for applet with app id ${appInfo.installed_app_id}`,
              );
            }
          }),
        );
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
    ipcMain.handle('get-version', (): string => app.getVersion());
    ipcMain.handle('get-conductor-info', (): ConductorInfo | undefined => {
      return HOLOCHAIN_MANAGER
        ? {
            app_port: HOLOCHAIN_MANAGER.appPort,
            admin_port: HOLOCHAIN_MANAGER.adminPort,
            moss_version: app.getVersion(),
            weave_protocol_version: '0.14',
          }
        : undefined;
    });
    ipcMain.handle(
      'get-tool-icon',
      async (
        _e,
        toolId: string,
        resourceLocation?: ResourceLocation,
      ): Promise<string | undefined> => {
        if (resourceLocation) {
          return readIcon(resourceLocation);
        }
        return WE_FILE_SYSTEM.readToolIcon(toolId);
      },
    );
    ipcMain.handle(
      'get-group-profile',
      (_e, groupDnaHashB64: DnaHashB64): GroupProfile | undefined => {
        return WE_FILE_SYSTEM.readGroupProfile(groupDnaHashB64);
      },
    );
    ipcMain.handle(
      'store-group-profile',
      (_e, groupDnaHashB64: DnaHashB64, groupProfile: GroupProfile): void => {
        return WE_FILE_SYSTEM.storeGroupProfile(groupDnaHashB64, groupProfile);
      },
    );
    ipcMain.handle('lair-setup-required', (): boolean => {
      return !WE_FILE_SYSTEM.keystoreInitialized();
    });
    ipcMain.handle('install-group-happ', async (_e, withProgenitor: boolean): Promise<AppInfo> => {
      const apps = await HOLOCHAIN_MANAGER!.adminWebsocket.listApps({});
      let agentPubKey = globalPubKeyFromListAppsResponse(apps);
      if (!agentPubKey) {
        agentPubKey = await HOLOCHAIN_MANAGER!.adminWebsocket.generateAgentPubKey();
      }

      // generate random network seed
      const networkSeed = uuidv4();
      const hash = createHash('sha256');
      hash.update(networkSeed);
      const hashedSeed = hash.digest('base64');
      const appId = `group#${hashedSeed}#${withProgenitor ? encodeHashToBase64(agentPubKey) : null}`;
      console.log('Determined appId for group: ', appId);

      const groupHappPath = path.join(DEFAULT_APPS_DIRECTORY, 'group.happ');

      const properties = withProgenitor
        ? { progenitor: encodeHashToBase64(agentPubKey) }
        : { progenitor: null };

      let appInfo: AppInfo;

      // Try installing the app twice. It may fail the first time with a timeout error
      // if wasms take too long to compile. This should only happen the very first time
      // a group happ is being installed.
      try {
        appInfo = await HOLOCHAIN_MANAGER!.adminWebsocket.installApp({
          source: {
            type: 'path',
            value: groupHappPath,
          },
          installed_app_id: appId,
          agent_key: agentPubKey,
          network_seed: networkSeed,
          roles_settings: {
            group: {
              type: 'provisioned',
              value: {
                modifiers: {
                  properties,
                },
              },
            },
          },
        });
      } catch (e) {
        console.warn('Failed to install group happ: ', e, '\nRetrying once...');
        WE_EMITTER.emitMossError(`Failed to install group happ: ${e}.\n Retrying once...`);
        appInfo = await HOLOCHAIN_MANAGER!.adminWebsocket.installApp({
          source: {
            type: 'path',
            value: groupHappPath,
          },
          installed_app_id: appId,
          agent_key: agentPubKey,
          network_seed: networkSeed,
          roles_settings: {
            group: {
              type: 'provisioned',
              value: {
                modifiers: {
                  properties,
                },
              },
            },
          },
        });
      }
      await HOLOCHAIN_MANAGER!.adminWebsocket.enableApp({ installed_app_id: appId });
      return appInfo;
    });
    ipcMain.handle(
      'join-group',
      async (_e, networkSeed: string, progenitor: AgentPubKeyB64 | null): Promise<AppInfo> => {
        const apps = await HOLOCHAIN_MANAGER!.adminWebsocket.listApps({});
        let agentPubKey = globalPubKeyFromListAppsResponse(apps);
        if (!agentPubKey) {
          agentPubKey = await HOLOCHAIN_MANAGER!.adminWebsocket.generateAgentPubKey();
        }
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

        console.log('got progenitor: ', progenitor);
        console.log('got networkSeed: ', networkSeed);
        const groupHappPath = path.join(DEFAULT_APPS_DIRECTORY, 'group.happ');

        const appInfo = await HOLOCHAIN_MANAGER!.adminWebsocket.installApp({
          source: {
            type: 'path',
            value: groupHappPath,
          },
          installed_app_id: appId,
          agent_key: agentPubKey,
          network_seed: networkSeed,
          roles_settings: {
            group: {
              type: 'provisioned',
              value: {
                modifiers: {
                  properties: { progenitor },
                },
              },
            },
          },
        });
        await HOLOCHAIN_MANAGER!.adminWebsocket.enableApp({ installed_app_id: appId });
        return appInfo;
      },
    );
    ipcMain.handle(
      'fetch-and-validate-happ-or-webhapp',
      async (_e, url: string): Promise<AppHashes> => {
        const response = await net.fetch(url);
        const byteArray = Array.from(new Uint8Array(await response.arrayBuffer()));
        const { happSha256, webhappSha256, uiSha256 } =
          await rustUtils.validateHappOrWebhapp(byteArray);
        if (uiSha256) {
          if (!webhappSha256) throw Error('Ui sha256 defined but not webhapp sha256.');
          return {
            type: 'webhapp',
            sha256: webhappSha256,
            happ: {
              sha256: happSha256,
            },
            ui: {
              sha256: uiSha256,
            },
          };
        } else {
          return {
            type: 'happ',
            sha256: happSha256,
          };
        }
      },
    );
    ipcMain.handle('validate-happ-or-webhapp', async (_e, bytes: number[]): Promise<AppHashes> => {
      const { happSha256, webhappSha256, uiSha256 } = await rustUtils.validateHappOrWebhapp(bytes);
      if (uiSha256) {
        if (!webhappSha256) throw Error('Ui sha256 defined but not webhapp sha256.');
        return {
          type: 'webhapp',
          sha256: webhappSha256,
          happ: {
            sha256: happSha256,
          },
          ui: {
            sha256: uiSha256,
          },
        };
      } else {
        return {
          type: 'happ',
          sha256: happSha256,
        };
      }
    });

    ipcMain.handle(
      'batch-update-applet-uis',
      async (
        _e,
        toolCompatibilityId: ToolCompatibilityId,
        happOrWebHappUrl: string,
        distributionInfo: DistributionInfo,
        sha256Happ: string,
        sha256Ui: string,
        sha256Webhapp: string,
      ): Promise<AppletId[]> => {
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
          const { happSha256, webhappSha256, uiSha256 } =
            await rustUtils.validateHappOrWebhapp(assetBytes);

          if (happSha256 !== sha256Happ)
            throw new Error(
              `The downloaded resource has an invalid happ hash. The source may be corrupted.\nGot hash '${happSha256}' but expected hash ${sha256Happ}`,
            );
          if (webhappSha256 && webhappSha256 !== sha256Webhapp)
            throw new Error(
              `The downloaded resource has an invalid webhapp hash. The source may be corrupted.\nGot hash '${webhappSha256}' but expected hash ${sha256Webhapp}`,
            );
          if (uiSha256 && uiSha256 !== sha256Ui)
            throw new Error(
              `The downloaded resource has an invalid UI hash. The source may be corrupted.\nGot hash '${uiSha256}' but expected hash ${sha256Ui}`,
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
          await rustUtils.saveHappOrWebhapp(webHappPath, happsDir, uisDir);
          try {
            // clean up
            fs.rmSync(tmpDir, { recursive: true });
          } catch (e) {}
        } else {
          console.log(
            '@batch-update-applet-uis: UI already on the filesystem. Skipping download from remote source.',
          );
        }

        // That the happ hash is the same as with the previous installation needs to be checked in the frontend
        const appAssetsInfoNew: AppAssetsInfo = deriveAppAssetsInfo(
          distributionInfo,
          happOrWebHappUrl,
          sha256Happ,
          sha256Webhapp,
          sha256Ui,
        );

        // Find all applets that can be updated and update them
        const allApps = await HOLOCHAIN_MANAGER!.adminWebsocket.listApps({});
        const allAppletAppIds = allApps
          .filter((appInfo) => appInfo.installed_app_id.startsWith('applet#'))
          .map((appInfo) => appInfo.installed_app_id);

        allAppletAppIds.forEach((appId) => {
          const appAssetInfoExisting = WE_FILE_SYSTEM.readAppAssetsInfo(appId);
          if (
            appAssetInfoExisting.type === 'webhapp' &&
            appAssetInfoExisting.happ.sha256 === sha256Happ &&
            appAssetInfoExisting.distributionInfo.type === 'web2-tool-list' &&
            appAssetInfoExisting.distributionInfo.info.toolCompatibilityId === toolCompatibilityId
          ) {
            WE_FILE_SYSTEM.backupAppAssetsInfo(appId);
            WE_FILE_SYSTEM.storeAppAssetsInfo(appId, appAssetsInfoNew);
          }
        });

        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });

        // Clear the cache of Tool Class UI asset directories to make sure
        // cross-group views get the new UI served as well going forward
        WE_FILE_SYSTEM.clearToolUiAssetsCache();

        return allAppletAppIds.map((id) => appletIdFromAppId(id));
      },
    );
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
          const { happSha256, webhappSha256, uiSha256 } =
            await rustUtils.validateHappOrWebhapp(assetBytes);

          if (happSha256 !== sha256Happ)
            throw new Error(
              `The downloaded resource has an invalid happ hash. The source may be corrupted.\nGot hash '${happSha256}' but expected hash ${sha256Happ}`,
            );
          if (webhappSha256 && webhappSha256 !== sha256Webhapp)
            throw new Error(
              `The downloaded resource has an invalid webhapp hash. The source may be corrupted.\nGot hash '${webhappSha256}' but expected hash ${sha256Webhapp}`,
            );
          if (uiSha256 && uiSha256 !== sha256Ui)
            throw new Error(
              `The downloaded resource has an invalid UI hash. The source may be corrupted.\nGot hash '${uiSha256}' but expected hash ${sha256Ui}`,
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
          await rustUtils.saveHappOrWebhapp(webHappPath, happsDir, uisDir);
          try {
            // clean up
            fs.rmSync(tmpDir, { recursive: true });
          } catch (e) {}
        } else {
          console.log(
            '@update-applet-ui: UI already on the filesystem. Skipping download from remote source.',
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
        // Clear the cache of Tool Class UI asset directories to make sure
        // cross-group views get the new UI served as well going forward
        WE_FILE_SYSTEM.clearToolUiAssetsCache();
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
      },
    );
    ipcMain.handle('uninstall-applet', async (_e, appId: string): Promise<void> => {
      await HOLOCHAIN_MANAGER!.adminWebsocket.uninstallApp({
        installed_app_id: appId,
      });
      try {
        WE_FILE_SYSTEM.deleteAppMetaDataDir(appId);
      } catch (e: any) {
        WE_EMITTER.emitMossError(e);
      }
    });
    ipcMain.handle('dump-network-stats', async (_e): Promise<void> => {
      const stats = await HOLOCHAIN_MANAGER!.adminWebsocket.dumpNetworkStats();
      const filePath = path.join(WE_FILE_SYSTEM.profileLogsDir, 'network_stats.json');
      fs.writeFileSync(filePath, JSON.stringify(stats, undefined, 2), 'utf-8');
    });
    ipcMain.handle(
      'install-applet-bundle',
      async (
        _e,
        appId: string,
        networkSeed: string,
        happOrWebHappUrl: string,
        distributionInfo: DistributionInfo,
        appHashes: AppHashes,
        uiPort?: number,
      ): Promise<AppInfo> => {
        const apps = await HOLOCHAIN_MANAGER!.adminWebsocket.listApps({});
        const alreadyInstalledAppInfo = apps.find((appInfo) => appInfo.installed_app_id === appId);

        // We need to distinguish 3 possible cases:
        //
        // 1. happ is not installed in the conductor yet (normal case)
        //
        // 2. happ is already installed in the conductor and app asset info is stored as well.
        //    This case can occur in edge cases where Moss got interrupted after installing
        //    an app into the conductor but before joining it in the group dna.
        //
        //    We handle this case by returning AppInfo directly and skipping any of the
        //    installation steps.
        //
        // 3. happ is already installed in the conductor but app asset info is not stored yet.
        //    This case should not happen at all but we cover it anyway to be sure.
        //
        //    We handle this case by skipping the installation of the happ in the conductor.

        if (alreadyInstalledAppInfo) {
          try {
            WE_FILE_SYSTEM.readAppAssetsInfo(appId);
            // If reading app asset info succeds we're in case 2 and we return AppInfo
            return alreadyInstalledAppInfo;
          } catch (e) {
            // We're in case 3 and will ignore installing the happ in the conductor later
            // but can ignore this error
          }
        }

        if (distributionInfo.type !== 'web2-tool-list')
          throw new Error(`Unsupported distribution type ${distributionInfo.type}`);

        // Fetch the icon and store it
        const toolCompatibilityId = toolCompatibilityIdFromDistInfo(distributionInfo);
        if (!WE_FILE_SYSTEM.readToolIcon(toolCompatibilityId)) {
          if (
            !!RUN_OPTIONS.devInfo &&
            distributionInfo.info.toolListUrl.startsWith('###DEVCONFIG###')
          ) {
            const appletConfig = RUN_OPTIONS.devInfo.config.applets.find(
              (appletConfig) => appletConfig.name === distributionInfo.info.toolName,
            );
            if (!appletConfig) throw new Error('Dev mode applet not found in dev config');
            const base64Icon = await readIcon(appletConfig.icon);
            WE_FILE_SYSTEM.storeToolIconIfNecessary(toolCompatibilityId, base64Icon);
          } else {
            try {
              const resp = await net.fetch(distributionInfo.info.toolListUrl);
              const toolList: DeveloperCollectiveToolList = await resp.json();
              const toolInfo: ToolInfoAndVersions | undefined = toolList.tools.find(
                (tool) =>
                  tool.id === distributionInfo.info.toolId &&
                  tool.versionBranch === distributionInfo.info.versionBranch,
              );
              if (!toolInfo) throw new Error('Tool not found in fetched Tool list.');
              const iconUrl = new URL(toolInfo.icon); // Validate that it's a proper URL
              // Try to fetch the icon 3 times in case it fails due to
              const base64Icon = await retryNTimes(
                async () => {
                  const iconResponse = await net.fetch(iconUrl.toString());
                  const image = await Jimp.fromBuffer(await iconResponse.arrayBuffer());
                  image.resize({ w: 300, h: 300 });
                  const mimeType = mime.getType(toolInfo.icon) || 'image/png';
                  if (!['image/jpeg', 'image/png'].includes(mimeType))
                    throw new Error('Only jpg and png icons are supported.');
                  return await image.getBase64(mimeType as 'image/jpeg' | 'image/png');
                },
                3,
                100,
              );
              WE_FILE_SYSTEM.storeToolIconIfNecessary(toolCompatibilityId, base64Icon);
            } catch (e) {
              throw new Error(`Failed to fetch Tool icon: ${e}`);
            }
          }
        }

        let sha256Ui = appHashes.type === 'webhapp' ? appHashes.ui.sha256 : undefined;
        let sha256Webhapp = appHashes.type === 'webhapp' ? appHashes.sha256 : undefined;
        let sha256Happ = appHashes.type === 'webhapp' ? appHashes.happ.sha256 : appHashes.sha256;
        console.log('INSTALLING APPLET BUNDLE. uiPort: ', uiPort);

        let agentPubKey = globalPubKeyFromListAppsResponse(apps);
        if (!agentPubKey) {
          agentPubKey = await HOLOCHAIN_MANAGER!.adminWebsocket.generateAgentPubKey();
        }

        // Check if .happ and ui assets are already stored on the filesystem and don't need to get fetched from the source
        let happAlreadyStoredPath = path.join(WE_FILE_SYSTEM.happsDir, `${sha256Happ}.happ`);
        const happAlreadyStored = fs.existsSync(happAlreadyStoredPath);
        const uiAlreadyStored =
          !!sha256Ui && fs.existsSync(path.join(WE_FILE_SYSTEM.uisDir, sha256Ui, 'assets'));

        let happToBeInstalledPath: string | undefined;
        let tmpDir: string | undefined;

        const isDevModeAndTrustedToolFromDevConfig =
          !!RUN_OPTIONS.devInfo && sha256Happ.startsWith('###DEVCONFIG###');

        // In devmode always fetch it because we don't want to fetch and pre-compute the sha256
        // hashes of all Tools listed in the devconfig which is why they are not known at this
        // stage and have a ###DEVCONFIG### placeholder instead.
        // We do need the actual hashes however as a means to address the associated resources
        // on the filesystem.
        if (!happAlreadyStored || !uiAlreadyStored || isDevModeAndTrustedToolFromDevConfig) {
          // fetch webhapp from URL
          const fixedHappOrWebHappUrl = happOrWebHappUrl.startsWith('file://')
            ? `file://${path.resolve(happOrWebHappUrl.slice(7))}`
            : happOrWebHappUrl;

          console.log('Fetching happ/webhapp from URL: ', fixedHappOrWebHappUrl);
          const response = await net.fetch(fixedHappOrWebHappUrl);
          const buffer = await response.arrayBuffer();

          const uisDir = path.join(WE_FILE_SYSTEM.uisDir);
          const happsDir = path.join(WE_FILE_SYSTEM.happsDir);

          const assetBytes = Array.from(new Uint8Array(buffer));
          console.log('validating webhapp...');
          const { happSha256, webhappSha256, uiSha256 } =
            await rustUtils.validateHappOrWebhapp(assetBytes);
          console.log('webhapp validated.');

          // Except in dev mode with a provided UI port, only .webhapp files are allowed, no pure .happ files
          if (!uiPort && !RUN_OPTIONS.devInfo && (!webhappSha256 || !uiSha256))
            throw new Error('Fetched resource is not a .webhapp file.');

          // Overwrite the ###DEVCONFIG### placeholders with the actual sha256 hashes
          // if it's a trusted Tool from the dev config
          if (isDevModeAndTrustedToolFromDevConfig) {
            sha256Happ = happSha256;
            sha256Ui = uiSha256;
            sha256Webhapp = webhappSha256;
          }

          // Check the hashes unless we're in dev mode and it's a Tool from the dev config
          const isTrustedToolFromDevConfig =
            RUN_OPTIONS.devInfo && distributionInfo.info.toolListUrl.startsWith('###DEVCONFIG###');

          if (!isTrustedToolFromDevConfig) {
            if (happSha256 !== sha256Happ)
              throw new Error(
                `The downloaded resource has an invalid happ hash. The source may be corrupted.\nGot hash '${happSha256}' but expected hash ${sha256Happ}`,
              );
            if (webhappSha256 && webhappSha256 !== sha256Webhapp)
              throw new Error(
                `The downloaded resource has an invalid webhapp hash. The source may be corrupted.\nGot hash '${webhappSha256}' but expected hash ${sha256Webhapp}`,
              );
            if (uiSha256 && uiSha256 !== sha256Ui)
              throw new Error(
                `The downloaded resource has an invalid UI hash. The source may be corrupted.\nGot hash '${uiSha256}' but expected hash ${sha256Ui}`,
              );
            if (sha256Webhapp && !sha256Ui)
              throw new Error('Got applet with a webhapp hash but no UI hash.');
          }

          tmpDir = path.join(os.tmpdir(), `we-applet-${nanoid(8)}`);
          fs.mkdirSync(tmpDir, { recursive: true });
          const webHappPath = path.join(tmpDir, 'applet_to_install.webhapp');
          fs.writeFileSync(webHappPath, new Uint8Array(buffer));
          // NOTE: It's possible that an existing happ is being overwritten here. This shouldn't be a problem though.
          console.log('Saving webhapp...');
          const { happPath } = await rustUtils.saveHappOrWebhapp(webHappPath, happsDir, uisDir);
          console.log('webhapp saved.');

          happToBeInstalledPath = happPath;
          try {
            // clean up
            fs.rmSync(tmpDir, { recursive: true });
          } catch (e) {}
        } else {
          console.log(
            '@install-applet-bundle: happ and UI already on the filesystem. Skipping download from remote source.',
          );
        }

        // Store app metadata
        const appAssetsInfo: AppAssetsInfo = deriveAppAssetsInfo(
          distributionInfo,
          happOrWebHappUrl,
          sha256Happ,
          sha256Webhapp,
          sha256Ui,
          uiPort,
        );
        WE_FILE_SYSTEM.storeAppAssetsInfo(appId, appAssetsInfo);

        let appInfo: AppInfo;

        if (!alreadyInstalledAppInfo) {
          // We're in the normal Case 1.
          try {
            appInfo = await HOLOCHAIN_MANAGER!.adminWebsocket.installApp({
              source: {
                type: 'path',
                value: happToBeInstalledPath ? happToBeInstalledPath : happAlreadyStoredPath,
              },
              installed_app_id: appId,
              agent_key: agentPubKey,
              network_seed: networkSeed,
            });
            console.log('@install-applet-bundle: app installed.');
          } catch (e: any) {
            // Remove app meta data directory again if the error unless it's a CellAlreadyExists error
            // in which case we don't want to remove the meta data of an existing app
            if (e.toString && !e.toString().includes('CellAlreadyExists')) {
              WE_FILE_SYSTEM.deleteAppMetaDataDir(appId);
            }
            throw new Error(`Failed to install app: ${e}`);
          }
        } else {
          // We're in Case 3
          appInfo = alreadyInstalledAppInfo;
        }

        // Enable the app after storing metadata in case enabling fails
        try {
          await HOLOCHAIN_MANAGER!.adminWebsocket.enableApp({ installed_app_id: appId });
        } catch (e) {
          // If the app failed to get enabled due to a reason other than awaiting memproofs, log it
          // but continue. The app would then need to get enabled in the UI.
          if (appInfo.status.type !== 'awaiting_memproofs') {
            WE_EMITTER.emitMossError(`ERROR: Failed to enable app: ${e}`);
          }
        }

        // remove temp dir again
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });

        return appInfo;
      },
    );
    ipcMain.handle('uninstall-applet-bundle', async (_e, appId: string): Promise<void> => {
      await HOLOCHAIN_MANAGER!.adminWebsocket.uninstallApp({
        installed_app_id: appId,
      });
      WE_FILE_SYSTEM.deleteAppMetaDataDir(appId);
    });
    ipcMain.handle('launch', async (_e): Promise<boolean> => {
      let isFirstLaunch = !WE_FILE_SYSTEM.keystoreInitialized();
      const password = WE_FILE_SYSTEM.readOrCreateRandomPassword();
      [LAIR_HANDLE, HOLOCHAIN_MANAGER, WE_RUST_HANDLER] = await launch(
        WE_FILE_SYSTEM,
        WE_EMITTER,
        SPLASH_SCREEN_WINDOW,
        password,
        RUN_OPTIONS,
      );
      console.log(CACHED_DEEP_LINK);
      return isFirstLaunch;

      // // Send cached deep link to main window after a timeout to make sure the event listener is ready
      // if (CACHED_DEEP_LINK) {
      //   setTimeout(() => {
      //     if (MAIN_WINDOW) {
      //       emitToWindow(MAIN_WINDOW, 'deep-link-received', CACHED_DEEP_LINK);
      //     }
      //   }, 8000);
      // }
    });
    ipcMain.handle('moss-update-available', () => UPDATE_AVAILABLE);
    ipcMain.handle('install-moss-update', async () => {
      if (!UPDATE_AVAILABLE) throw new Error('No update available.');
      // downloading means that with the next start of the application it's automatically going to be installed
      autoUpdater.on('update-downloaded', () => autoUpdater.quitAndInstall());
      autoUpdater.on('download-progress', (progressInfo) => {
        if (MAIN_WINDOW) {
          emitToWindow(MAIN_WINDOW, 'moss-update-progress', progressInfo);
        }
      });
      await autoUpdater.downloadUpdate();
    });
  }

  /**
   * -------------------------------------------------------
   * App Events
   * -------------------------------------------------------
   */

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (MAIN_WINDOW) {
      createOrShowMainWindow();
    }
  });

  app.on('before-quit', () => {
    if (!isAppQuitting) {
      // If the quitting process takes longer than 15 seconds, force quit.
      setTimeout(() => {
        WE_EMITTER.emitMossError('FORCE QUITTING. Quitting Moss took longer than 15 seconds.');
        // ignore beforeunload of all windows
        MAIN_WINDOW?.webContents.on('will-prevent-unload', (e) => {
          e.preventDefault();
        });
        MAIN_WINDOW?.close();
        Object.values(WAL_WINDOWS).forEach((windowInfo) => {
          const walWindow = windowInfo.window;
          if (walWindow) {
            walWindow.webContents.on('will-prevent-unload', (e) => {
              e.preventDefault();
            });
            walWindow.webContents.close();
          }
        });
      }, 15000);
    }
    isAppQuitting = true;
    // on-before-unload
    // This is to discern in the beforeunload listener between a reaload
    // and a window close
    if (MAIN_WINDOW) MAIN_WINDOW.hide();
    if (SYSTRAY) {
      SYSTRAY.setImage(SYSTRAY_ICON_QUITTING);
      SYSTRAY.setContextMenu(Menu.buildFromTemplate([]));
    }
    if (MAIN_WINDOW) emitToWindow(MAIN_WINDOW, 'window-closing', null);
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
}

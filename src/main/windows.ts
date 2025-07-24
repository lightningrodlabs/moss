import { BrowserWindow, nativeImage, net, session } from 'electron';
import path from 'path';
import url from 'url';
import { MossFileSystem } from './filesystem';
import { setLinkOpenHandlers } from './utils';
import { is } from '@electron-toolkit/utils';
import { ICONS_DIRECTORY } from './paths';

/**
 * Creates a Window to render a WAL in an applet iframe
 */
export const createWalWindow = (): BrowserWindow => {
  // Create the browser window.
  let walWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/walwindow.js'),
      safeDialogs: true,
      // Otherwise polling zome calls will stop working properly
      backgroundThrottling: false,
    },
  });

  walWindow.menuBarVisible = false;

  setLinkOpenHandlers(walWindow);

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    walWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/walwindow.html`);
  } else {
    // Note: It's important that it shares the origin with the main window so that
    // localStorage is shared between iframes of the same applet instance in the
    // main window and WAL windows because chromium partitions localStorage by
    // the iframe's parent origin as well
    // - https://github.com/electron/electron/issues/43106#issuecomment-2270965371
    // - https://chromium-review.googlesource.com/c/chromium/src/+/4899223
    walWindow.loadURL('moss://admin.renderer/walwindow.html');
  }

  // walWindow.on('close', () => {
  //   console.log(`Happ window with frame id ${walWindow.id} about to be closed.`);
  //   // prevent closing here and hide instead in case notifications are to be received from this happ UI
  // });

  return walWindow;
};

export const createSplashscreenWindow = (): BrowserWindow => {
  const icon = nativeImage.createFromPath(path.join(ICONS_DIRECTORY, '../icon.png'));

  // Create the browser window.
  const splashWindow = new BrowserWindow({
    height: 450,
    width: 800,
    center: true,
    resizable: false,
    show: false,
    backgroundColor: '#331ead',
    icon,
    // use these settings so that the ui
    // can listen for status change events
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/splashscreen.js'),
      safeDialogs: true,
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

export const createHappWindow = (
  appId: string,
  mossFileSystem: MossFileSystem,
  appPort: number,
) => {
  // TODO create mapping between installed-app-id's and window ids
  const uiAssetsDir = mossFileSystem.appUiAssetsDir(appId);
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
        `<head><script type="module">window.__HC_LAUNCHER_ENV__ = { APP_INTERFACE_PORT: ${appPort}, INSTALLED_APP_ID: "${appId}", FRAMEWORK: "electron" };</script>`,
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
      safeDialogs: true,
      // Otherwise polling zome calls will stop working properly
      backgroundThrottling: false,
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

import { BrowserWindow, net, session } from 'electron';
import path from 'path';
import url from 'url';
import { WeFileSystem } from './filesystem';
import { setLinkOpenHandlers } from './utils';
import { APPSTORE_APP_ID } from './sharedTypes';

export const createHappWindow = (
  appId: string,
  launcherFileSystem: WeFileSystem,
  appPort: number,
) => {
  // TODO create mapping between installed-app-id's and window ids
  const uiAssetsDir = [APPSTORE_APP_ID].includes(appId)
    ? path.join(launcherFileSystem.uisDir, appId, 'assets')
    : launcherFileSystem.appUiAssetsDir(appId);
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

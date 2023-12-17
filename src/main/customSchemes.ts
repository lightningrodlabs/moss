import { protocol, net } from 'electron';
import { WeFileSystem } from './filesystem';
import url from 'url';
import path from 'path';
import fs from 'fs';
import { HolochainManager } from './holochainManager';

const APPLET_IFRAME_SCRIPT = fs.readFileSync(
  path.resolve(__dirname, '../applet-iframe/index.mjs'),
  'utf-8',
);

export async function handleAppletProtocol(weFileSystem: WeFileSystem) {
  protocol.handle('applet', async (request) => {
    // console.log('### Got applet request: ', request);
    // console.log('### Got request with url: ', request.url);
    const uriWithoutProtocol = request.url.split('://')[1];
    const uriWithoutQueryString = uriWithoutProtocol.split('?')[0];
    const uriComponents = uriWithoutQueryString.split('/');
    const lowerCasedAppletId = uriComponents[0].replaceAll('%24', '$');

    const installedAppId = `applet#${lowerCasedAppletId}`;

    const uiAssetsDir = weFileSystem.appUiAssetsDir(installedAppId);

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

      const content = await indexHtmlResponse.text();

      // lit uses the $` combination (https://github.com/lit/lit/issues/4433) so string replacement
      // needs to happen a bit cumbersomely
      const htmlComponents = content.split('<head>');
      htmlComponents.splice(1, 0, '<head>');
      htmlComponents.splice(2, 0, `<script type="module">${APPLET_IFRAME_SCRIPT}</script>`);
      let modifiedContent = htmlComponents.join('');

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
}

export async function handleDefaultAppsProtocol(
  weFileSystem: WeFileSystem,
  holochainManager: HolochainManager | undefined,
) {
  protocol.handle('default-app', async (request) => {
    // urls of type default-app://app-id
    const uriWithoutProtocol = request.url.split('://')[1];
    const uriWithoutQueryString = uriWithoutProtocol.split('?')[0];
    const uriComponents = uriWithoutQueryString.split('/');

    const installedAppId = `default-app#${uriComponents[0]}`;

    const uiAssetsDir = weFileSystem.appUiAssetsDir(installedAppId);

    if (!holochainManager) throw new Error('HolochainManager not defined');

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
      const content = await indexHtmlResponse.text();
      // lit uses the $` combination (https://github.com/lit/lit/issues/4433) so string replacement
      // needs to happen a bit cumbersomely
      const htmlComponents = content.split('<head>');
      htmlComponents.splice(1, 0, '<head>');
      htmlComponents.splice(
        2,
        0,
        `<script type="module">window.__HC_LAUNCHER_ENV__={ INSTALLED_APP_ID: "${installedAppId}", APP_INTERFACE_PORT: ${holochainManager.appPort} }</script>`,
      );
      let modifiedContent = htmlComponents.join('');

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
}

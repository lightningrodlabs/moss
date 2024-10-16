import { protocol, net } from 'electron';
import { MossFileSystem } from './filesystem';
import url from 'url';
import path from 'path';
import fs from 'fs';
import { HolochainManager } from './holochainManager';

const APPLET_IFRAME_SCRIPT = fs.readFileSync(
  path.resolve(__dirname, '../applet-iframe/index.mjs'),
  'utf-8',
);

const HAPP_IFRAME_SCRIPT = fs.readFileSync(
  path.resolve(__dirname, '../happ-iframe/index.mjs'),
  'utf-8',
);

export async function handleAppletProtocol(mossFileSystem: MossFileSystem) {
  protocol.handle('applet', async (request) => {
    // console.log('### Got applet request: ', request);
    // console.log('### Got request with url: ', request.url);
    const uriWithoutProtocol = request.url.split('://')[1];
    const uriWithoutQueryString = uriWithoutProtocol.split('?')[0];
    const uriComponents = uriWithoutQueryString.split('/');
    const lowerCasedAppletId = uriComponents[0].replaceAll('%24', '$');

    const installedAppId = `applet#${lowerCasedAppletId}`;

    const uiAssetsDir = mossFileSystem.appUiAssetsDir(installedAppId);

    if (!uiAssetsDir) {
      throw new Error(
        `Failed to find UI assets directory for requested applet assets. AppId: ${installedAppId}`,
      );
    }

    const absolutePath = path.join(uiAssetsDir, ...uriComponents.slice(1));

    // TODO possible performance optimization to not do the fs.existSync here but just
    // fall back if net.fetch fails for the absoultePath in the else clause
    if (
      uriComponents.length === 1 ||
      (uriComponents.length === 2 &&
        (uriComponents[1] === '' || uriComponents[1] === 'index.html')) ||
      !fs.existsSync(absolutePath)
    ) {
      let indexHtmlResponse: Response;
      try {
        indexHtmlResponse = await net.fetch(
          url.pathToFileURL(path.join(uiAssetsDir, 'index.html')).toString(),
        );
      } catch (e) {
        return new Response(
          'No index.html found. If you are the developer of this Tool, make sure that the index.html is located at the root level of your UI assets.',
        );
      }

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
      return net.fetch(url.pathToFileURL(absolutePath).toString());
    }
  });
}

export async function handleDefaultAppsProtocol(
  mossFileSystem: MossFileSystem,
  holochainManager: HolochainManager | undefined,
) {
  protocol.handle('default-app', async (request) => {
    // urls of type default-app://app-id
    const uriWithoutProtocol = request.url.split('://')[1];
    const uriWithoutQueryString = uriWithoutProtocol.split('?')[0];
    const uriComponents = uriWithoutQueryString.split('/');

    const installedAppId = `default-app#${uriComponents[0]}`;

    const uiAssetsDir = mossFileSystem.appUiAssetsDir(installedAppId);

    if (!holochainManager) throw new Error('HolochainManager not defined');

    if (!uiAssetsDir) {
      throw new Error(
        `Failed to find UI assets directory for requested applet assets. AppId: ${installedAppId}`,
      );
    }

    if (
      uriComponents.length === 1 ||
      (uriComponents.length === 2 && (uriComponents[1] === '' || uriComponents[1] === 'index.html'))
    ) {
      const indexHtmlResponse = await net.fetch(
        url.pathToFileURL(path.join(uiAssetsDir, 'index.html')).toString(),
      );
      const content = await indexHtmlResponse.text();
      const token = await holochainManager.getAppToken(installedAppId);

      // lit uses the $` combination (https://github.com/lit/lit/issues/4433) so string replacement
      // needs to happen a bit cumbersomely
      const htmlComponents = content.split('<head>');
      htmlComponents.splice(1, 0, '<head>');
      htmlComponents.splice(
        2,
        0,
        `<script type="module">${HAPP_IFRAME_SCRIPT};window.__USING_FEEDBACK=true;window.__HC_LAUNCHER_ENV__={ INSTALLED_APP_ID: "${installedAppId}", APP_INTERFACE_PORT: ${holochainManager.appPort}, APP_INTERFACE_TOKEN: [${token}] }</script>`,
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

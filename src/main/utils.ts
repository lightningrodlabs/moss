import { BrowserWindow, app, net, shell } from 'electron';
import fs from 'fs';
import mime from 'mime';
import semver from 'semver';
import os from 'os';
import { breakingAppVersion } from './filesystem';
import {
  CallZomeRequest,
  CallZomeRequestSigned,
  getNonceExpiration,
  randomNonce,
} from '@holochain/client';
import { encode } from '@msgpack/msgpack';
import { WeRustHandler } from '@lightningrodlabs/we-rust-utils';
import { ResourceLocation, WeaveDevConfig } from '@theweave/moss-types';
import { sha512 } from 'js-sha512';

export const isMac = process.platform === 'darwin';
export const isWindows = process.platform === 'win32';
export const isLinux = process.platform === 'linux';

export function setLinkOpenHandlers(browserWindow: BrowserWindow): void {
  // links in happ windows should open in the system default application
  browserWindow.webContents.on('will-frame-navigate', (e) => {
    // console.log('GOT WILL-FRAME-NAVIGATE EVENT: ', e);
    if (e.url.startsWith('http://localhost:')) {
      // ignore vite routing in dev mode
      return;
    }
    if (e.url.startsWith('weave-0.14://')) {
      emitToWindow(browserWindow, 'deep-link-received', e.url);
      e.preventDefault();
      return;
    }
    if (
      e.url.startsWith('http://') ||
      e.url.startsWith('https://') ||
      e.url.startsWith('mailto:')
    ) {
      e.preventDefault();
      // This event is emitted to allow the window to prevent the
      // beforeunload event to execute
      emitToWindow(browserWindow, 'will-navigate-external', null);
      shell.openExternal(e.url);
    }
  });
  // instead of the webview
  browserWindow.webContents.on('will-navigate', (e) => {
    // console.log('GOT WILL-NAVIGATE EVENT: ', e);
    if (e.url.startsWith('http://localhost:')) {
      // ignore vite routing in dev mode
      return;
    }
    if (e.url.startsWith('weave-0.14://')) {
      emitToWindow(browserWindow, 'deep-link-received', e.url);
      e.preventDefault();
      return;
    }
    if (
      e.url.startsWith('http://') ||
      e.url.startsWith('https://') ||
      e.url.startsWith('mailto:')
    ) {
      e.preventDefault();
      // This event is emitted to allow the window to prevent the
      // beforeunload event to execute
      emitToWindow(browserWindow, 'will-navigate-external', null);
      shell.openExternal(e.url);
    }
  });

  // Links with target=_blank should open in the system default browser and
  // happ windows are not allowed to spawn new electron windows
  browserWindow.webContents.setWindowOpenHandler((details) => {
    // console.log('GOT NEW WINDOW EVENT: ', details);
    if (details.url.startsWith('weave-0.14://')) {
      emitToWindow(browserWindow, 'deep-link-received', details.url);
    }
    if (details.url.startsWith('http://') || details.url.startsWith('https://')) {
      shell.openExternal(details.url);
    }
    return { action: 'deny' };
  });
}

export function emitToWindow<T>(targetWindow: BrowserWindow, channel: string, payload: T): void {
  targetWindow.webContents.send(channel, payload);
}

export function breakingVersion(version: string): string {
  if (!semver.valid(version)) {
    throw new Error('App has an invalid version number.');
  }
  const prerelease = semver.prerelease(version);
  if (prerelease) {
    return `${semver.major(version)}.${semver.minor(version)}.${semver.patch(version)}-${prerelease[0]}`;
  }
  switch (semver.major(version)) {
    case 0:
      switch (semver.minor(version)) {
        case 0:
          return `0.0.${semver.patch(version)}`;
        default:
          return `0.${semver.minor(version)}.x`;
      }
    default:
      return `${semver.major(version)}.x.x`;
  }
}

export function defaultAppNetworkSeed(devConfig?: WeaveDevConfig): string {
  return devConfig || !app.isPackaged
    ? `moss-applet-dev-${os.hostname()}`
    : `moss-${breakingAppVersion(app)}`;
}

export async function signZomeCall(
  request: CallZomeRequest,
  handler: WeRustHandler,
): Promise<CallZomeRequestSigned> {
  if (!request.provenance)
    return Promise.reject(
      'Call zome request has provenance field not set. This should be set by the js-client.',
    );

  const zomeCallToSign: CallZomeRequest = {
    cell_id: request.cell_id,
    zome_name: request.zome_name,
    fn_name: request.fn_name,
    payload: encode(request.payload),
    provenance: request.provenance,
    nonce: await randomNonce(),
    expires_at: getNonceExpiration(),
  };

  const zomeCallBytes = encode(zomeCallToSign);
  const bytesHash = sha512.array(zomeCallBytes);

  const signature: number[] = await handler.signZomeCall(bytesHash, Array.from(request.provenance));

  const signedZomeCall: CallZomeRequestSigned = {
    bytes: zomeCallBytes,
    signature: Uint8Array.from(signature),
  };

  return signedZomeCall;
}

export async function readIcon(location: ResourceLocation) {
  switch (location.type) {
    case 'filesystem': {
      const data = fs.readFileSync(location.path);
      const mimeType = mime.getType(location.path);
      return `data:${mimeType};base64,${data.toString('base64')}`;
    }
    case 'https': {
      const response = await net.fetch(location.url);
      const arrayBuffer = await response.arrayBuffer();
      const mimeType = mime.getType(location.url);
      return `data:${mimeType};base64,${_arrayBufferToBase64(arrayBuffer)}`;
    }

    default:
      throw new Error(
        `Fetching icon from source type ${
          (location as any).type
        } is not implemented. Got icon source: ${location}.`,
      );
  }
}

function _arrayBufferToBase64(buffer) {
  var binary = '';
  var bytes = new Uint8Array(buffer);
  var len = bytes.byteLength;
  for (var i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function logIf(condition: boolean, msg: string, ...args: any[]) {
  if (condition) console.log(msg, ...args);
}

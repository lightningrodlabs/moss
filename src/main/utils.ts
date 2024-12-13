import { BrowserWindow, app, shell } from 'electron';
import semver from 'semver';
import os from 'os';
import { breakingAppVersion } from './filesystem';
import {
  AgentPubKey,
  CallZomeRequest,
  CallZomeRequestSigned,
  getNonceExpiration,
  ListAppsResponse,
  randomNonce,
} from '@holochain/client';
import { encode } from '@msgpack/msgpack';
import { WeRustHandler, ZomeCallUnsignedNapi } from '@lightningrodlabs/we-rust-utils';
import { WeDevConfig } from '@theweave/moss-types';

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
    if (e.url.startsWith('weave-0.13://')) {
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
    if (e.url.startsWith('weave-0.13://')) {
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
      shell.openExternal(e.url);
    }
  });

  // Links with target=_blank should open in the system default browser and
  // happ windows are not allowed to spawn new electron windows
  browserWindow.webContents.setWindowOpenHandler((details) => {
    // console.log('GOT NEW WINDOW EVENT: ', details);
    if (details.url.startsWith('weave-0.13://')) {
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

export function defaultAppNetworkSeed(devConfig?: WeDevConfig): string {
  return devConfig || !app.isPackaged
    ? `moss-applet-dev-${os.hostname()}`
    : `moss-${breakingAppVersion(app)}`;
}

export async function signZomeCall(
  request: CallZomeRequest,
  handler: WeRustHandler,
): Promise<CallZomeRequestSigned> {
  const zomeCallUnsignedNapi: ZomeCallUnsignedNapi = {
    provenance: Array.from(request.provenance),
    cellId: [Array.from(request.cell_id[0]), Array.from(request.cell_id[1])],
    zomeName: request.zome_name,
    fnName: request.fn_name,
    payload: Array.from(encode(request.payload)),
    nonce: Array.from(await randomNonce()),
    expiresAt: getNonceExpiration(),
  };

  const zomeCallSignedNapi = await handler.signZomeCall(zomeCallUnsignedNapi);

  const zomeCallSigned: CallZomeRequestSigned = {
    provenance: Uint8Array.from(zomeCallSignedNapi.provenance),
    cap_secret: null,
    cell_id: [
      Uint8Array.from(zomeCallSignedNapi.cellId[0]),
      Uint8Array.from(zomeCallSignedNapi.cellId[1]),
    ],
    zome_name: zomeCallSignedNapi.zomeName,
    fn_name: zomeCallSignedNapi.fnName,
    payload: Uint8Array.from(zomeCallSignedNapi.payload),
    signature: Uint8Array.from(zomeCallSignedNapi.signature),
    expires_at: zomeCallSignedNapi.expiresAt,
    nonce: Uint8Array.from(zomeCallSignedNapi.nonce),
  };

  return zomeCallSigned;
}

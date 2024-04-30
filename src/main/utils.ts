import { BrowserWindow, app, shell } from 'electron';
import semver from 'semver';
import os from 'os';
import { breakingAppVersion } from './filesystem';
import { WeDevConfig } from './cli/defineConfig';

export function setLinkOpenHandlers(browserWindow: BrowserWindow): void {
  // links in happ windows should open in the system default application
  browserWindow.webContents.on('will-frame-navigate', (e) => {
    // console.log('GOT WILL-NAVIGATE EVENT: ', e);
    if (e.url.startsWith('http://localhost:')) {
      // ignore vite routing in dev mode
      return;
    }
    if (e.url.startsWith('weave-0.12://')) {
      emitToWindow(browserWindow, 'deep-link-received', e.url);
    }
    if (
      e.url.startsWith('http://') ||
      e.url.startsWith('https://') ||
      e.url.startsWith('mailto://')
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
    if (e.url.startsWith('weave-0.12://')) {
      emitToWindow(browserWindow, 'deep-link-received', e.url);
    }
    if (
      e.url.startsWith('http://') ||
      e.url.startsWith('https://') ||
      e.url.startsWith('mailto://')
    ) {
      e.preventDefault();
      shell.openExternal(e.url);
    }
  });

  // Links with target=_blank should open in the system default browser and
  // happ windows are not allowed to spawn new electron windows
  browserWindow.webContents.setWindowOpenHandler((details) => {
    console.log('GOT NEW WINDOW EVENT: ', details);
    if (details.url.startsWith('weave-0.12://')) {
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
  if (semver.prerelease(version)) {
    return version;
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

import { BrowserWindow, ipcMain, shell } from 'electron';
import { is } from '@electron-toolkit/utils';
import fs from 'fs';
import path from 'path';
import { setLinkOpenHandlers } from './utils';

export type AboutInfo = {
  mossVersion: string;
  holochainVersion: string;
  /** Whether Electron's bundled Chromium notices file can be opened. */
  hasChromiumNotices: boolean;
};

let aboutWindow: BrowserWindow | null = null;

/**
 * Electron ships Chromium's third-party notices as LICENSES.chromium.html. Its
 * location differs between platforms and between dev and packaged builds.
 */
function chromiumNoticesPath(): string | undefined {
  const candidates = [
    path.join(path.dirname(process.execPath), 'LICENSES.chromium.html'),
    path.join(process.resourcesPath, 'LICENSES.chromium.html'),
    path.join(process.resourcesPath, '..', 'LICENSES.chromium.html'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

/** Opens the About window, or focuses it if it is already open. */
export function openAboutWindow(): void {
  if (aboutWindow) {
    aboutWindow.focus();
    return;
  }
  aboutWindow = new BrowserWindow({
    width: 560,
    height: 680,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: 'About Moss',
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/about.js'),
      safeDialogs: true,
    },
  });
  setLinkOpenHandlers(aboutWindow);
  aboutWindow.on('closed', () => {
    aboutWindow = null;
  });
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    aboutWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/about.html`);
  } else {
    aboutWindow.loadFile(path.join(__dirname, '../renderer/about.html'));
  }
}

/** IPC used by the About window's preload (src/preload/about.ts). */
export function registerAboutIpc(info: () => Omit<AboutInfo, 'hasChromiumNotices'>): void {
  ipcMain.handle(
    'about-info',
    (): AboutInfo => ({ ...info(), hasChromiumNotices: !!chromiumNoticesPath() }),
  );
  ipcMain.handle('about-open-chromium-notices', async () => {
    const file = chromiumNoticesPath();
    if (file) await shell.openPath(file);
  });
}

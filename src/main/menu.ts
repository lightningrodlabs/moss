import { Menu, app, dialog, shell, BrowserWindow } from 'electron';
import { MossFileSystem } from './filesystem';
import { emitToWindow, isMac } from './utils';
import AdmZip from 'adm-zip';

// extending from electron's default menu: https://github.com/electron/electron/blob/398dde9dfbdfcfd7757ead9a30785c01de9f0808/lib/browser/default-menu.ts#L12
export const mossMenu = (
  mossFileSystem: MossFileSystem,
  getMainWindow: () => BrowserWindow | null | undefined,
) => {
  const macAppMenu: Electron.MenuItemConstructorOptions = { role: 'appMenu' };
  const helpMenu: Electron.MenuItemConstructorOptions = {
    role: 'help',
    submenu: [
      {
        label: 'Settings',
        async click() {
          const maybeMainWindow = getMainWindow();
          if (maybeMainWindow) {
            emitToWindow(maybeMainWindow, 'request-factory-reset', null);
          }
        },
      },
      {
        label: 'Open Logs',
        async click() {
          await mossFileSystem.openLogs();
        },
      },
      {
        label: 'Export Logs',
        async click() {
          await mossFileSystem.exportLogs();
        },
      },
    ],
  };

  const applicationMenu: Electron.MenuItemConstructorOptions = {
    label: 'Moss',
    submenu: [
      {
        label: 'Restart',
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
    ],
  };

  return Menu.buildFromTemplate([
    ...(isMac ? [macAppMenu] : []),
    applicationMenu,
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    helpMenu,
  ]);
};

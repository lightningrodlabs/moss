import { Menu, dialog, shell } from 'electron';
import { WeFileSystem } from './filesystem';
import { isMac } from './utils';

// extending from electron's default menu: https://github.com/electron/electron/blob/398dde9dfbdfcfd7757ead9a30785c01de9f0808/lib/browser/default-menu.ts#L12
export const mossMenu = (mossFileSystem: WeFileSystem) => {
  const macAppMenu: Electron.MenuItemConstructorOptions = { role: 'appMenu' };
  const helpMenu: Electron.MenuItemConstructorOptions = {
    role: 'help',
    submenu: [
      {
        label: 'Open Logs',
        async click() {
          try {
            await shell.openPath(mossFileSystem.appLogsDir);
          } catch (e) {
            dialog.showErrorBox('Failed to open logs folder', (e as any).toString());
          }
        },
      },
    ],
  };

  return Menu.buildFromTemplate([
    ...(isMac ? [macAppMenu] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    helpMenu,
  ]);
};

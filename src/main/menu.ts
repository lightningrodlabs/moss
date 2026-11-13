import { Menu, app } from 'electron';
import { MossFileSystem } from './filesystem';
import { isMac } from './utils';
import { mossMenuTemplate } from './menuTemplate';
import { openAboutWindow } from './aboutWindow';

export const mossMenu = (mossFileSystem: MossFileSystem) =>
  Menu.buildFromTemplate(
    mossMenuTemplate(isMac, {
      about: openAboutWindow,
      restart() {
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
      quit: () => app.quit(),
      openLogs: () => mossFileSystem.openLogs(),
      exportLogs: () => mossFileSystem.exportLogs(),
    }),
  );

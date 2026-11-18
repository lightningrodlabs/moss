export type MossMenuHandlers = {
  about: () => void;
  restart: () => void;
  quit: () => void;
  openLogs: () => void | Promise<void>;
  exportLogs: () => void | Promise<void>;
};

/**
 * The application menu, extending Electron's default menu:
 * https://github.com/electron/electron/blob/398dde9dfbdfcfd7757ead9a30785c01de9f0808/lib/browser/default-menu.ts#L12
 *
 * "About Moss" sits where each platform expects it: first in the app menu on
 * macOS, last in the Help menu elsewhere.
 */
export function mossMenuTemplate(
  isMac: boolean,
  handlers: MossMenuHandlers,
): Electron.MenuItemConstructorOptions[] {
  const about: Electron.MenuItemConstructorOptions = {
    label: 'About Moss',
    click: () => handlers.about(),
  };

  const macAppMenu: Electron.MenuItemConstructorOptions = {
    label: 'Moss',
    submenu: [
      about,
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };

  const helpMenu: Electron.MenuItemConstructorOptions = {
    role: 'help',
    submenu: [
      { label: 'Open Logs', click: () => handlers.openLogs() },
      { label: 'Export Logs', click: () => handlers.exportLogs() },
      ...(isMac ? [] : [{ type: 'separator' } as const, about]),
    ],
  };

  const applicationMenu: Electron.MenuItemConstructorOptions = {
    label: 'Moss',
    submenu: [
      { label: 'Restart', click: () => handlers.restart() },
      { label: 'Quit', type: 'normal', click: () => handlers.quit() },
    ],
  };

  return [
    ...(isMac ? [macAppMenu] : []),
    applicationMenu,
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    helpMenu,
  ];
}

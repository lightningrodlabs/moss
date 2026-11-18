import { describe, expect, it, vi } from 'vitest';

import { mossMenuTemplate } from './menuTemplate';

type Item = Electron.MenuItemConstructorOptions;

const handlers = {
  about: vi.fn(),
  restart: vi.fn(),
  quit: vi.fn(),
  openLogs: vi.fn(),
  exportLogs: vi.fn(),
};

const submenuOf = (item: Item | undefined): Item[] => (item?.submenu as Item[] | undefined) ?? [];

describe('mossMenuTemplate', () => {
  it('puts About Moss first in the macOS app menu', () => {
    const template = mossMenuTemplate(true, handlers);
    const appMenu = submenuOf(template[0]);
    expect(appMenu[0].label).toBe('About Moss');
    appMenu[0].click!({} as never, undefined, {} as never);
    expect(handlers.about).toHaveBeenCalled();
    expect(template.find((m) => m.role === 'help')?.submenu).not.toContainEqual(
      expect.objectContaining({ label: 'About Moss' }),
    );
  });

  it('keeps the standard macOS app menu roles', () => {
    const roles = submenuOf(mossMenuTemplate(true, handlers)[0]).map((i) => i.role);
    expect(roles).toEqual(
      expect.arrayContaining(['services', 'hide', 'hideOthers', 'unhide', 'quit']),
    );
  });

  it('puts About Moss last in the Help menu on Windows and Linux', () => {
    const template = mossMenuTemplate(false, handlers);
    const help = submenuOf(template.find((m) => m.role === 'help'));
    expect(help[help.length - 1].label).toBe('About Moss');
    expect(help[help.length - 2].type).toBe('separator');
    expect(template[0].label).toBe('Moss');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { holdUnloadWhileSaving } from './unload-hold';

function fakeEvent() {
  return {
    preventDefault: vi.fn(),
    returnValue: undefined as unknown,
  } as unknown as BeforeUnloadEvent & {
    preventDefault: ReturnType<typeof vi.fn>;
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('holdUnloadWhileSaving', () => {
  it('cancels the unload before any await, so the browser honors it', () => {
    const listener = holdUnloadWhileSaving({
      isExternalNavigation: () => new Promise(() => {}),
      save: async () => {},
      finish: () => {},
    });
    const e = fakeEvent();
    listener(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.returnValue).toBe(false);
  });

  it('saves, then finishes the reload or close itself', async () => {
    const order: string[] = [];
    const listener = holdUnloadWhileSaving({
      isExternalNavigation: async () => false,
      save: async () => {
        order.push('save');
      },
      finish: () => order.push('finish'),
    });
    listener(fakeEvent());
    await settle();
    expect(order).toEqual(['save', 'finish']);
  });

  it('finishes even when saving fails', async () => {
    const finish = vi.fn();
    const listener = holdUnloadWhileSaving({
      isExternalNavigation: async () => false,
      save: async () => {
        throw new Error('save failed');
      },
      finish,
    });
    listener(fakeEvent());
    await settle();
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('keeps the page when the unload came from opening an external location', async () => {
    const save = vi.fn(async () => {});
    const finish = vi.fn();
    const listener = holdUnloadWhileSaving({
      isExternalNavigation: async () => true,
      save,
      finish,
    });
    listener(fakeEvent());
    await settle();
    expect(save).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  it('saves once when the unload is triggered again while saving', async () => {
    let release!: () => void;
    const save = vi.fn(() => new Promise<void>((r) => (release = r)));
    const finish = vi.fn();
    const listener = holdUnloadWhileSaving({
      isExternalNavigation: async () => false,
      save,
      finish,
    });
    listener(fakeEvent());
    await settle();
    const second = fakeEvent();
    listener(second);
    expect(second.preventDefault).toHaveBeenCalled();
    release();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
  });
});

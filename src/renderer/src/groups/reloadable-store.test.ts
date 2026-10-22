import { describe, expect, it, vi } from 'vitest';
import { readable, writable, type Readable } from 'svelte/store';
import { isReloadable, reloadableStore } from './reloadable-store';

describe('reloadableStore', () => {
  it('passes the inner store values to subscribers', () => {
    const inner = writable(1);
    const store = reloadableStore(() => inner);
    const seen: number[] = [];
    const unsub = store.subscribe((v) => seen.push(v));
    inner.set(2);
    unsub();
    expect(seen).toEqual([1, 2]);
  });

  it('builds a fresh inner store on reload and moves every subscriber to it', () => {
    let n = 0;
    const build = vi.fn(() => readable(++n));
    const store = reloadableStore(build);
    const a: number[] = [];
    const b: number[] = [];
    const ua = store.subscribe((v) => a.push(v));
    const ub = store.subscribe((v) => b.push(v));
    store.reload();
    expect(build).toHaveBeenCalledTimes(2);
    expect(a[a.length - 1]).toBe(2);
    expect(b[b.length - 1]).toBe(2);
    ua();
    ub();
  });

  it('shares one inner store between subscribers of the same generation', () => {
    const build = vi.fn(() => readable(7));
    const store = reloadableStore(build);
    const ua = store.subscribe(() => {});
    const ub = store.subscribe(() => {});
    expect(build).toHaveBeenCalledTimes(1);
    ua();
    ub();
  });

  it('stops the inner store when the last subscriber leaves', () => {
    const stop = vi.fn();
    const store = reloadableStore(() => readable(0, () => stop));
    const ua = store.subscribe(() => {});
    const ub = store.subscribe(() => {});
    ua();
    expect(stop).not.toHaveBeenCalled();
    ub();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('stops the previous inner store on reload', () => {
    const stops: Array<() => void> = [];
    const store = reloadableStore(() => {
      const stop = vi.fn();
      stops.push(stop);
      return readable(0, () => stop);
    });
    const unsub = store.subscribe(() => {});
    store.reload();
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(stops[1]).not.toHaveBeenCalled();
    unsub();
    expect(stops[1]).toHaveBeenCalledTimes(1);
  });
});

describe('isReloadable', () => {
  it('tells a reloadable store from a plain one', () => {
    const plain: Readable<number> = readable(0);
    expect(isReloadable(reloadableStore(() => plain))).toBe(true);
    expect(isReloadable(plain)).toBe(false);
  });
});

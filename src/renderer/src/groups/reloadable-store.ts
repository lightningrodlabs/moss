import { readable, writable, type Readable, type Unsubscriber } from 'svelte/store';

/** A store whose source can be rebuilt on demand while its subscribers stay attached. */
export interface ReloadableStore<T> extends Readable<T> {
  reload(): void;
}

/**
 * Wraps the store returned by `build` so that `reload()` replaces it with a freshly built one.
 * All subscribers of one generation share a single inner store; on reload they all move to the
 * next one, and the last subscriber leaving releases the inner store.
 */
export function reloadableStore<T>(build: () => Readable<T>): ReloadableStore<T> {
  const generation = writable(0);
  const outer = readable<T>(undefined, (set) => {
    let unsubInner: Unsubscriber | undefined;
    const unsubGeneration = generation.subscribe(() => {
      unsubInner?.();
      unsubInner = build().subscribe(set);
    });
    return () => {
      unsubGeneration();
      unsubInner?.();
      unsubInner = undefined;
    };
  });
  return {
    subscribe: outer.subscribe,
    reload: () => generation.update((g) => g + 1),
  };
}

export function isReloadable<T>(store: Readable<T>): store is ReloadableStore<T> {
  return typeof (store as Partial<ReloadableStore<T>>).reload === 'function';
}

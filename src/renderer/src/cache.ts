import { AttachableLocationAndInfo, HrlWithContext } from '@lightningrodlabs/we-applet';
import { stringifyHrlWithContext } from './utils';
import { SubStore } from './persisted-store';

/**
 * Cache for We
 */
export class WeCache {
  private store: KeyValueStore;

  constructor(store?: KeyValueStore) {
    this.store = store ? store : new SessionStorageStore();
  }

  attachableInfo: SubStore<
    AttachableLocationAndInfo | undefined,
    AttachableLocationAndInfo,
    [HrlWithContext]
  > = {
    value: (hrlWithContext: HrlWithContext) => {
      const stringifiedHrlWithContext = stringifyHrlWithContext(hrlWithContext);
      return this.store.getItem<AttachableLocationAndInfo>(
        `attachableInfo#${stringifiedHrlWithContext}`,
      );
    },
    set: (value, hrlWithContext: HrlWithContext) =>
      this.store.setItem(`attachableInfo#${stringifyHrlWithContext(hrlWithContext)}`, value),
  };
}

export class SessionStorageStore implements KeyValueStore {
  getItem = <T>(key: string): T | undefined => {
    return getSessionStorageItem<T>(key);
  };

  setItem = <T>(key: string, value: T) => {
    setSessionStorageItem(key, value);
  };

  removeItem = (key: string) => {
    window.sessionStorage.removeItem(key);
  };

  clear = () => {
    window.sessionStorage.clear();
  };
}

export interface KeyValueStore {
  getItem: <T>(key: string) => T | undefined;
  setItem: <T>(key: string, value: T) => void;
  clear: () => void;
  removeItem: (key: string) => any;
}

export function getSessionStorageItem<T>(key: string): T | undefined {
  const item: string | null = window.sessionStorage.getItem(key);
  return item ? JSON.parse(item) : undefined;
}

export function setSessionStorageItem<T>(key: string, value: T): void {
  window.sessionStorage.setItem(key, JSON.stringify(value));
}

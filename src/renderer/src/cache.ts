import {
  AppletHash,
  AppletInfo,
  AttachableLocationAndInfo,
  HrlWithContext,
} from '@lightningrodlabs/we-applet';
import { stringifyHrlWithContext } from './utils';
import { SubStore } from './persisted-store';
import { encodeHashToBase64 } from '@holochain/client';
import { decode, encode } from '@msgpack/msgpack';
import { fromUint8Array, toUint8Array } from 'js-base64';

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

  appletInfo: SubStore<AppletInfo | undefined, AppletInfo, [AppletHash]> = {
    value: (appletHash: AppletHash) => {
      return this.store.getItem<AppletInfo>(`appletInfo#${encodeHashToBase64(appletHash)}`);
    },
    set: (value, appletHash) =>
      this.store.setItem(`appletInfo#${encodeHashToBase64(appletHash)}`, value),
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
  return item ? deStringifyItem(item) : undefined;
}

export function setSessionStorageItem<T>(key: string, value: T): void {
  window.sessionStorage.setItem(key, stringifyItem(value));
}

function stringifyItem(item): string {
  return fromUint8Array(encode(item));
}

function deStringifyItem<T>(item: any): T {
  return decode(toUint8Array(item)) as T;
}

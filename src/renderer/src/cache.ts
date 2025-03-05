import { AppletHash, AppletInfo, AssetLocationAndInfo, WAL } from '@theweave/api';
import { SubStore } from './persisted-store';
import { encodeHashToBase64 } from '@holochain/client';
import { decode, encode } from '@msgpack/msgpack';
import { fromUint8Array, toUint8Array } from 'js-base64';
import { stringifyWal } from '@theweave/api';

/**
 * Cache for We
 */
export class MossCache {
  private store: KeyValueStore;

  constructor(store?: KeyValueStore) {
    this.store = store ? store : new SessionStorageStore();
  }

  assetInfo: SubStore<AssetLocationAndInfo | undefined, AssetLocationAndInfo, [WAL]> = {
    value: (wal: WAL) => {
      const stringifiedWAL = stringifyWal(wal);
      return this.store.getItem<AssetLocationAndInfo>(`assetInfo#${stringifiedWAL}`);
    },
    set: (value, wal: WAL) => this.store.setItem(`assetInfo#${stringifyWal(wal)}`, value),
  };

  appletInfo: SubStore<AppletInfo | undefined, AppletInfo, [AppletHash]> = {
    value: (appletHash: AppletHash) => {
      return this.store.getItem<AppletInfo>(`appletInfo#${encodeHashToBase64(appletHash)}`);
    },
    set: (value, appletHash) =>
      this.store.setItem(`appletInfo#${encodeHashToBase64(appletHash)}`, value),
  };

  searchResults: SubStore<WAL[] | undefined, WAL[], [AppletHash, string]> = {
    value: (appletHash: AppletHash, searchFilter: string) => {
      return this.store.getItem<WAL[]>(`search#${encodeHashToBase64(appletHash)}#${searchFilter}}`);
    },
    set: (value, appletHash, searchFilter) => {
      return this.store.setItem<WAL[]>(
        `search#${encodeHashToBase64(appletHash)}#${searchFilter}}`,
        value,
      );
    },
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

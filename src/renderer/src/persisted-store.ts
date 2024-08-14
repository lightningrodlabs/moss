import { DnaHash, DnaHashB64, encodeHashToBase64 } from '@holochain/client';
import { AppletId, FrameNotification } from '@lightningrodlabs/we-applet';
import { AppletNotificationSettings } from './applets/types';
import { destringifyAndDecode, encodeAndStringify } from './utils';

/**
 * A store that's persisted.
 */
export class PersistedStore {
  private store: KeyValueStore;

  constructor(store?: KeyValueStore) {
    this.store = store ? store : new LocalStorageStore();
  }

  keys;

  pocket: SubStore<string[], string[], []> = {
    value: () => {
      const pocketContent = this.store.getItem<Array<string>>('pocket');
      return pocketContent ? pocketContent : [];
    },
    set: (value) => {
      this.store.setItem<string[]>('pocket', value);
    },
  };

  recentlyCreated: SubStore<string[], string[], []> = {
    value: () => {
      const recentlyCreatedContent = this.store.getItem<Array<string>>('recentlyCreated');
      return recentlyCreatedContent ? recentlyCreatedContent : [];
    },
    set: (value) => {
      this.store.setItem<string[]>('recentlyCreated', value);
    },
  };

  groupOrder: SubStore<DnaHashB64[], DnaHashB64[], []> = {
    value: () => {
      const groupOrder = this.store.getItem<Array<DnaHashB64>>('customGroupOrder');
      return groupOrder ? groupOrder : [];
    },
    set: (value) => this.store.setItem<Array<DnaHashB64>>('customGroupOrder', value),
  };

  ignoredApplets: SubStore<AppletId[], AppletId[], [DnaHashB64]> = {
    value: (groupDnaHashB64: DnaHashB64) => {
      const ignoredApplets = this.store.getItem<AppletId[]>(`ignoredApplets#${groupDnaHashB64}`);
      return ignoredApplets ? ignoredApplets : [];
    },
    set: (value, groupDnaHashB64: DnaHashB64) =>
      this.store.setItem(`ignoredApplets#${groupDnaHashB64}`, value),
  };

  appletLocalStorage: SubStore<Record<string, string>, Record<string, string>, [AppletId]> = {
    value: (appletId: AppletId) => {
      const appletLocalStorage = this.store.getItem<Record<string, string>>(
        `appletLocalStorage#${appletId}`,
      );
      return appletLocalStorage ? appletLocalStorage : {};
    },
    set: (value, appletId: AppletId) => this.store.setItem(`appletLocalStorage#${appletId}`, value),
  };

  appletNotificationsUnread: SubStore<
    Array<FrameNotification>,
    Array<FrameNotification>,
    [AppletId]
  > = {
    value: (appletId: AppletId) => {
      const unreadNotifications = this.store.getItem<Array<FrameNotification>>(
        `appletNotificationsUnread#${appletId}`,
      );
      return unreadNotifications ? unreadNotifications : [];
    },
    set: (value, appletId: AppletId) =>
      this.store.setItem(`appletNotificationsUnread#${appletId}`, value),
  };

  getAppletsWithUnreadNotifications = (): AppletId[] => {
    const appletIds: AppletId[] = [];
    this.store.keys().forEach((key) => {
      if (key.includes('appletNotificationsUnread#')) {
        const appletId = key.slice(26);
        appletIds.push(appletId);
      }
    });
    return appletIds;
  };

  appletNotifications: SubStore<
    Array<FrameNotification>,
    Array<FrameNotification>,
    [AppletId, number]
  > = {
    value: (appletId: AppletId, daysSinceEpoch: number) => {
      const notifications = this.store.getItem<Array<FrameNotification>>(
        `appletNotifications#${daysSinceEpoch}#${appletId}`,
      );
      return notifications ? notifications : [];
    },
    set: (value: Array<FrameNotification>, appletId: AppletId, daysSinceEpoch: number) =>
      this.store.setItem(`appletNotifications#${daysSinceEpoch}#${appletId}`, value),
  };

  appletNotificationSettings: SubStore<
    AppletNotificationSettings,
    AppletNotificationSettings,
    [AppletId]
  > = {
    value: (appletId: AppletId) => {
      const appletNotificationSettings = this.store.getItem<AppletNotificationSettings>(
        `appletNotificationSettings#${appletId}`,
      );
      return appletNotificationSettings
        ? appletNotificationSettings
        : {
            applet: {
              allowOSNotification: true,
              showInSystray: true,
              showInGroupSidebar: true,
              showInAppletSidebar: true,
              showInFeed: true,
            },
            notificationTypes: {},
          };
    },
    set: (value: AppletNotificationSettings, appletId: AppletId) =>
      this.store.setItem(`appletNotificationSettings#${appletId}`, value),
  };

  /**
   * When disabling all applets of a group the applets that were already disabled
   * get stored here in order to not re-enable them again if the groups gets
   * re-enabled
   */
  disabledGroupApplets: SubStore<
    Array<AppletId> | undefined,
    Array<AppletId> | undefined,
    [DnaHash]
  > = {
    value: (groupDnaHash: DnaHash) => {
      const disabledApplets = this.store.getItem<Array<AppletId>>(
        `disabledGroupApplets#${encodeHashToBase64(groupDnaHash)}`,
      );
      return disabledApplets;
    },
    set: (value: Array<AppletId> | undefined, groupDnaHash: DnaHash) => {
      const key = `disabledGroupApplets#${encodeHashToBase64(groupDnaHash)}`;
      if (value) {
        this.store.setItem(key, value);
      } else {
        this.store.removeItem(key);
      }
    },
  };
}

export interface SubStore<T, U, V extends any[]> {
  value: (...args: V) => T;
  set: (value: U, ...args: V) => void;
}

export class LocalStorageStore implements KeyValueStore {
  getItem = <T>(key: string): T | undefined => {
    return getLocalStorageItem<T>(key);
  };

  setItem = <T>(key: string, value: T) => {
    setLocalStorageItem(key, value);
  };

  removeItem = (key: string) => {
    window.localStorage.removeItem(key);
  };

  clear = () => {
    window.localStorage.clear();
  };

  keys = () => {
    return Object.keys(localStorage);
  };
}

export interface KeyValueStore {
  getItem: <T>(key: string) => T | undefined;
  setItem: <T>(key: string, value: T) => void;
  clear: () => void;
  removeItem: (key: string) => any;
  keys: () => string[];
}

export function getLocalStorageItem<T>(key: string): T | undefined {
  const item: string | null = window.localStorage.getItem(key);
  return item ? destringifyAndDecode<T>(item) : undefined;
}

export function setLocalStorageItem<T>(key: string, value: T): void {
  window.localStorage.setItem(key, encodeAndStringify(value));
}

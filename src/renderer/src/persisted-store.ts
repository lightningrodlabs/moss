import { DnaHash, DnaHashB64, encodeHashToBase64 } from '@holochain/client';
import { AppletId, FrameNotification } from '@theweave/api';
import { AppletNotificationSettings, GlobalNotificationSoundSettings } from './applets/types';
import { destringifyAndDecode, encodeAndStringify } from './utils';
import { WalInPocket } from './moss-store';
import { Profile } from '@holochain-open-dev/profiles';
import { DEFAULT_NOTIFICATION_SOUND_SETTINGS } from './services/notification-audio';

/**
 * A store that's persisted.
 */
export class PersistedStore {
  private store: KeyValueStore;

  constructor(store?: KeyValueStore) {
    this.store = store ? store : new LocalStorageStore();
  }

  /**
   * User's preferred locale for the UI (e.g. 'en', 'de', 'fr', 'es')
   */
  locale: SubStore<string, string, []> = {
    value: () => {
      const locale = this.store.getItem<string>('locale');
      return locale ? locale : 'en';
    },
    set: (value) => {
      this.store.setItem<string>('locale', value);
    },
  };

  /**
   * Whether design feedback mode is enabled (shows feedback icon overlay)
   */
  designFeedbackMode: SubStore<boolean, boolean, []> = {
    value: () => {
      const enabled = this.store.getItem<boolean>('designFeedbackMode');
      return enabled ? enabled : false;
    },
    set: (value) => {
      this.store.setItem<boolean>('designFeedbackMode', value);
    },
  };

  /**
   * Whether the applet sidebar is in collapsed mode or not
   */
  appletSidebarCollapsed: SubStore<boolean, boolean, []> = {
    value: () => {
      const appletSidebarCollapsed = this.store.getItem<boolean>('appletSidebarCollapsed');
      return appletSidebarCollapsed ? appletSidebarCollapsed : false;
    },
    set: (value) => {
      this.store.setItem<boolean>('appletSidebarCollapsed', value);
    },
  };

  /**
   * Array of Moss versions that have been declined
   */
  declinedMossUpdates: SubStore<string[], string[], []> = {
    value: () => {
      const declinedUpdates = this.store.getItem<string[]>('declinedMossUpdates');
      return declinedUpdates ? declinedUpdates : [];
    },
    set: (value) => {
      this.store.setItem<string[]>('declinedMossUpdates', value);
    },
  };

  personas: SubStore<Profile[], Profile[], []> = {
    value: () => {
      const personas = this.store.getItem<Profile[]>('personas');
      return personas ? personas : [];
    },
    set: (value) => {
      this.store.setItem<Profile[]>('personas', value);
    },
  };

  pocket: SubStore<WalInPocket[], WalInPocket[], []> = {
    value: () => {
      const pocketContent = this.store.getItem<Array<WalInPocket>>('pocket');
      return pocketContent ? pocketContent : [];
    },
    set: (value) => {
      this.store.setItem<WalInPocket[]>('pocket', value);
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

  groupAppletOrder: SubStore<AppletId[], AppletId[], [DnaHashB64]> = {
    value: (groupId: DnaHashB64) => {
      const appletOrder = this.store.getItem<AppletId[]>(`groupAppletOrder#${groupId}`);
      return appletOrder ? appletOrder : [];
    },
    set: (value, groupId: DnaHashB64) => this.store.setItem(`groupAppletOrder#${groupId}`, value),
  };

  ignoredApplets: SubStore<AppletId[], AppletId[], [DnaHashB64]> = {
    value: (groupDnaHashB64: DnaHashB64) => {
      const ignoredApplets = this.store.getItem<AppletId[]>(`ignoredApplets#${groupDnaHashB64}`);
      return ignoredApplets ? ignoredApplets : [];
    },
    set: (value, groupDnaHashB64: DnaHashB64) =>
      this.store.setItem(`ignoredApplets#${groupDnaHashB64}`, value),
  };

  // We don't need this anymore currently
  // appletLocalStorage: SubStore<Record<string, string>, Record<string, string>, [AppletId]> = {
  //   value: (appletId: AppletId) => {
  //     const appletLocalStorage = this.store.getItem<Record<string, string>>(
  //       `appletLocalStorage#${appletId}`,
  //     );
  //     return appletLocalStorage ? appletLocalStorage : {};
  //   },
  //   set: (value, appletId: AppletId) => this.store.setItem(`appletLocalStorage#${appletId}`, value),
  // };

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
   * Global notification sound settings
   */
  notificationSoundSettings: SubStore<
    GlobalNotificationSoundSettings,
    GlobalNotificationSoundSettings,
    []
  > = {
    value: () => {
      const settings = this.store.getItem<GlobalNotificationSoundSettings>(
        'notificationSoundSettings',
      );
      return settings ?? DEFAULT_NOTIFICATION_SOUND_SETTINGS;
    },
    set: (value: GlobalNotificationSoundSettings) => {
      this.store.setItem('notificationSoundSettings', value);
    },
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

import {
  CellId,
  CellInfo,
  AppInfo,
  ListAppsResponse,
  DnaHash,
  CellType,
  encodeHashToBase64,
  ClonedCell,
  DnaHashB64,
  decodeHashFromBase64,
  AgentPubKeyB64,
  Timestamp,
  DnaModifiers,
  InstalledAppId,
} from '@holochain/client';
import {
  Hrl,
  WAL,
  RenderView,
  FrameNotification,
  AppletHash,
  AppletId,
  ParentToAppletMessage,
  IframeKind,
} from '@theweave/api';
import { GroupDnaProperties } from '@theweave/group-client';
import { decode, encode } from '@msgpack/msgpack';
import { Base64, fromUint8Array, toUint8Array } from 'js-base64';
import isEqual from 'lodash-es/isEqual.js';

import { AppletNotificationSettings, NotificationSettings } from './applets/types.js';
import { MessageContentPart, ToolAndCurationInfo } from './types.js';
import { notifyError } from '@holochain-open-dev/elements';
import { PersistedStore } from './persisted-store.js';
import {
  AsyncReadable,
  AsyncStatus,
  readable,
  toPromise,
  writable,
} from '@holochain-open-dev/stores';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { MossStore } from './moss-store.js';
import { getAppletDevPort } from './electron-api.js';
import {
  appIdFromAppletId,
  appletIdFromAppId,
  deriveToolCompatibilityId,
  toLowerCaseB64,
  toOriginalCaseB64,
} from '@theweave/utils';
import { DeveloperCollecive, ToolCompatibilityId, WeaveDevConfig } from '@theweave/moss-types';

export function iframeOrigin(iframeKind: IframeKind): string {
  switch (iframeKind.type) {
    case 'applet':
      return `applet://${toLowerCaseB64(encodeHashToBase64(iframeKind.appletHash))}`;
    case 'cross-group':
      return `cross-group://${toLowerCaseB64(iframeKind.toolCompatibilityId)}`;
  }
}

export function appletOriginFromAppletId(appletId: AppletId): string {
  return `applet://${toLowerCaseB64(appletId)}`;
}

export function getAppletIdFromOrigin(origin: string): AppletId {
  const lowercaseB64IdWithPercent = origin.split('://')[1].split('?')[0].split('/')[0];
  const lowercaseB64Id = lowercaseB64IdWithPercent.replace(/%24/g, '$');
  return toOriginalCaseB64(lowercaseB64Id);
}

export function getToolCompatibilityIdFromOrigin(origin: string): ToolCompatibilityId {
  const lowercaseB64IdWithPercent = origin.split('://')[1].split('?')[0].split('/')[0];
  const lowercaseB64Id = lowercaseB64IdWithPercent.replace(/%24/g, '$');
  return toOriginalCaseB64(lowercaseB64Id);
}

/**
 * This function assumes that there is only a single app with this same dna
 *
 * @param apps
 * @param dnaHash
 * @returns
 */
export function findAppForDnaHash(
  apps: ListAppsResponse,
  dnaHash: DnaHash,
): { appInfo: AppInfo; roleName: string } | undefined {
  for (const app of apps) {
    for (const [roleName, cells] of Object.entries(app.cell_info)) {
      for (const cell of cells) {
        if (cell.type === CellType.Cloned) {
          if (encodeHashToBase64(cell.value.cell_id[0]) === encodeHashToBase64(dnaHash)) {
            return { appInfo: app, roleName: cell.value.clone_id };
          }
        } else if (cell.type === CellType.Provisioned) {
          if (encodeHashToBase64(cell.value.cell_id[0]) === encodeHashToBase64(dnaHash)) {
            return { appInfo: app, roleName };
          }
        }
      }
    }
  }
  return undefined;
}

export function getStatus(app: AppInfo): string {
  if (isAppRunning(app)) {
    return 'RUNNING';
  } else if (isAppDisabled(app)) {
    return 'DISABLED';
  } else if (isAppPaused(app)) {
    return 'PAUSED';
  } else {
    return 'UNKNOWN';
  }
}

export function isAppRunning(app: AppInfo): boolean {
  return app.status.type === 'running';
}
export function isAppDisabled(app: AppInfo): boolean {
  return app.status.type === 'disabled';
}
export function isAppPaused(app: AppInfo): boolean {
  return app.status.type === 'paused';
}

export function getCellId(cellInfo: CellInfo): CellId | undefined {
  if (cellInfo.type === CellType.Provisioned) {
    return cellInfo.value.cell_id;
  }
  if (cellInfo.type === CellType.Cloned) {
    return cellInfo.value.cell_id;
  }
  return undefined;
}

export function getCellName(cellInfo: CellInfo): string | undefined {
  if (cellInfo.type === CellType.Provisioned) {
    return cellInfo.value.name;
  }
  if (cellInfo.type === CellType.Cloned) {
    return cellInfo.value.name;
  }
  if (cellInfo.type === CellType.Stem) {
    return cellInfo.value.name;
  }
  return undefined;
}

export function getCellNetworkSeed(cellInfo: CellInfo): string | undefined {
  if (cellInfo.type === CellType.Provisioned) {
    return cellInfo.value.dna_modifiers.network_seed;
  }
  if (cellInfo.type === CellType.Cloned) {
    return cellInfo.value.dna_modifiers.network_seed;
  }
  return undefined;
}

export function dnaHashForCell(cell: CellInfo): DnaHashB64 {
  return encodeHashToBase64(new Uint8Array(getCellId(cell)![0]));
}

export function flattenCells(cell_info: Record<string, CellInfo[]>): [string, CellInfo][] {
  return Object.entries(cell_info)
    .map(([roleName, cellInfos]) => cellInfos.map((CellInfo) => [roleName, CellInfo]))
    .flat() as any;
}

export function getProvisionedCells(appInfo: AppInfo): [string, CellInfo][] {
  const provisionedCells = flattenCells(appInfo.cell_info)
    .filter(([_roleName, cellInfo]) => cellInfo.type === CellType.Provisioned)
    .sort(([roleName_a, _cellInfo_a], [roleName_b, _cellInfo_b]) =>
      roleName_a.localeCompare(roleName_b),
    );
  return provisionedCells;
}

export function getEnabledClonedCells(appInfo: AppInfo): [string, CellInfo][] {
  return flattenCells(appInfo.cell_info)
    .filter(([_roleName, cellInfo]) => cellInfo.type === CellType.Cloned)
    .filter(([_roleName, cellInfo]) => (cellInfo.value as ClonedCell).enabled)
    .sort(([roleName_a, _cellInfo_a], [roleName_b, _cellInfo_b]) =>
      roleName_a.localeCompare(roleName_b),
    );
}

export function getDisabledClonedCells(appInfo: AppInfo): [string, CellInfo][] {
  return flattenCells(appInfo.cell_info)
    .filter(([_roleName, cellInfo]) => cellInfo.type === CellType.Cloned)
    .filter(([_roleName, cellInfo]) => !(cellInfo.value as ClonedCell).enabled)
    .sort(([roleName_a, _cellInfo_a], [roleName_b, _cellInfo_b]) =>
      roleName_a.localeCompare(roleName_b),
    );
}

export function validateNotifications(notifications: Array<FrameNotification>): void {
  notifications.forEach((notification) => {
    if (typeof notification.title !== 'string') {
      throw new Error("Received a notification with a title that's not of type string.");
    }
    if (typeof notification.body !== 'string') {
      throw new Error("Received a notification with a body that's not of type string.");
    }
    if (!['low', 'medium', 'high'].includes(notification.urgency)) {
      throw new Error(
        "Received a notification with an invalid urgency level. Valid urgency levels are ['low', 'medium', 'high'].",
      );
    }
    if (notification.icon_src && typeof notification.icon_src !== 'string') {
      throw new Error(
        'Received a notification an invalid icon_src attribute. Must be either of type string or undefined.',
      );
    }
    // validate timestamp
    if (typeof notification.timestamp !== 'number') {
      throw new Error(
        `Received a notification with a timestamp that's not a number: ${notification.timestamp}`,
      );
    } else if (!isMillisecondTimestamp(notification.timestamp)) {
      throw new Error(
        `Received a notification with a timestamp that's not in millisecond format: ${notification.timestamp}`,
      );
    }
  });
}

/**
 * Stores applet notifications to persisted store - to the array of unread notifications
 * as well as to a persistent (deduplicated) log of all received notifications
 *
 * @param notifications
 * @param appletId
 * @param storeUnread Whether or not to store the notifications to unread notifications
 * @returns
 */
export function storeAppletNotifications(
  notifications: Array<FrameNotification>,
  appletId: AppletId,
  storeUnread: boolean,
  persistedStore: PersistedStore,
): Array<FrameNotification> | undefined {
  let unreadNotifications: Array<FrameNotification> | undefined;
  if (storeUnread) {
    // store them to unread messages
    unreadNotifications = persistedStore.appletNotificationsUnread.value(appletId);
    const unreadNotificationStrings = unreadNotifications.map((notification) =>
      encodeAndStringify(notification),
    );
    const notificationStrings = notifications.map((notification) =>
      encodeAndStringify(notification),
    );
    const dedupedNotifications = [
      ...new Set([...unreadNotificationStrings, ...notificationStrings]),
    ];

    unreadNotifications = dedupedNotifications.map((notification) =>
      destringifyAndDecode(notification),
    ); // dedpulicated array

    persistedStore.appletNotificationsUnread.set(unreadNotifications, appletId);
  }

  // store to persisted time-indexed notifications log
  notifications.forEach((notification) => {
    const timestamp = notification.timestamp;
    const daysSinceEpoch = Math.floor(timestamp / 8.64e7);
    let notificationsOfSameDate = persistedStore.appletNotifications.value(
      appletId,
      daysSinceEpoch,
    );
    notificationsOfSameDate = [...new Set([...notificationsOfSameDate, notification])];
    persistedStore.appletNotifications.set(notificationsOfSameDate, appletId, daysSinceEpoch);
  });

  return unreadNotifications;
}

function isMillisecondTimestamp(timestamp: number): boolean {
  const now = 1690803917545;
  if (timestamp / now > 10 || now / timestamp > 1.5) {
    return false;
  }
  return true;
}

/**
 * Gets the state of unread notifications for an applet. Used to display
 * notification dots in sidebars
 * @param appletId
 * @returns
 */
export function loadAppletNotificationStatus(
  appletId: AppletId,
): [string | undefined, number | undefined] {
  const persistedStore = new PersistedStore();
  const unreadNotifications = persistedStore.appletNotificationsUnread.value(appletId);
  return getNotificationState(unreadNotifications);
}

/**
 * Reads the current applet notification states from persisted store
 *
 * @returns
 */
export function loadAllNotificationStates(): Record<
  AppletId,
  [string | undefined, number | undefined]
> {
  const states = {};
  const persistedStore = new PersistedStore();
  persistedStore.getAppletsWithUnreadNotifications().forEach((appletId) => {
    states[appletId] = loadAppletNotificationStatus(appletId);
  });
  return states;
}

/**
 * Returns a notification state of the form [urgency, counts], e.g. ["high", 2] given
 * an array of unread notifications
 *
 * @param unreadNotifications
 * @returns
 */
export function getNotificationState(
  unreadNotifications: Array<FrameNotification>,
): [string | undefined, number | undefined] {
  const notificationCounts = { low: 0, medium: 0, high: 0 };
  unreadNotifications.forEach((notification) => {
    notificationCounts[notification.urgency] += 1;
  });
  if (notificationCounts.high) {
    return ['high', notificationCounts.high];
  } else if (notificationCounts.medium) {
    return ['medium', notificationCounts.medium];
  } else if (notificationCounts.low) {
    return ['low', notificationCounts.low];
  }
  return [undefined, undefined];
}

/**
 * Clears all unread notifications of an applet to remove the corresponding
 * notification dots.
 * @param appletId
 */
export function clearAppletNotificationStatus(appletId: AppletId): void {
  const persistedStore = new PersistedStore();
  persistedStore.appletNotificationsUnread.set([], appletId);
}

/**
 * Gets the user-defined notification settings for the specified applet Id from persisted store
 * @param appletId
 * @returns
 */
export function getAppletNotificationSettings(appletId: AppletId): AppletNotificationSettings {
  const persistedStore = new PersistedStore();
  return persistedStore.appletNotificationSettings.value(appletId);
}

export function getNotificationTypeSettings(
  type: string,
  appletNotificationSettings: AppletNotificationSettings,
): NotificationSettings {
  const appletSettings = appletNotificationSettings.applet;
  const typeSettings = appletNotificationSettings.notificationTypes[type];
  if (typeSettings) {
    return {
      allowOSNotification: appletSettings.allowOSNotification && typeSettings.allowOSNotification,
      showInSystray: appletSettings.showInSystray && typeSettings.showInSystray,
      showInGroupSidebar: appletSettings.showInGroupSidebar && typeSettings.showInGroupSidebar,
      showInAppletSidebar: appletSettings.showInAppletSidebar && typeSettings.showInAppletSidebar,
      showInFeed: appletSettings.showInFeed && typeSettings.showInFeed,
    };
  }
  // If there are no type specific settings, use the applet-wide settings
  return appletNotificationSettings.applet;
}

export function encodeAndStringify(input: unknown): string {
  return fromUint8Array(encode(input));
}

export function destringifyAndDecode<T>(input: string): T {
  return decode(toUint8Array(input)) as T;
}

/**
 * Deduplicates an array of strings
 *
 * @param arr
 * @returns
 */
export function dedupStringArray(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

export function renderViewToQueryString(
  renderView:
    | RenderView
    | { type: 'applet-view'; view: { type: 'creatable'; creatableName: string; dialogId: string } },
): string {
  let base = `view=${renderView.type}`;

  if (renderView.view) {
    base = `view=${renderView.type}&view-type=${renderView.view.type}`;

    if (renderView.view.type === 'block') {
      base = `${base}&block=${renderView.view.block}`;
    }
    if (renderView.view.type === 'asset') {
      const wal = renderView.view.wal;
      base = `${base}&hrl=${stringifyHrl(wal.hrl)}`;
      if (wal.context) {
        const b64context = fromUint8Array(encode(wal.context), true);
        base = `${base}&context=${b64context}`;
      }
    }
    if (renderView.view.type === 'creatable') {
      if (!('dialogId' in renderView.view))
        throw new Error('dialog Id not provided in render view.');
      const creatableName = renderView.view.creatableName;
      // Note that this violates the typescript type
      const dialogId = renderView.view.dialogId;
      base = `${base}&creatable=${creatableName}&id=${dialogId}`;
    }
  }

  return base;
}

export function stringifyHrl(hrl: Hrl): string {
  return `hrl://${encodeHashToBase64(hrl[0])}/${encodeHashToBase64(hrl[1])}`;
}

export function encodeContext(context: any) {
  return fromUint8Array(encode(context), true);
}

export function decodeContext(contextStringified: string): any {
  return decode(toUint8Array(contextStringified));
}

/**
 * Fetches an image, crops it to 300x300px, compresses it to max 200KB and
 * returns the base64 encoded value of the resized image.
 *
 * @param src
 * @returns
 */
export async function fetchResizeAndExportImg(src: string): Promise<string> {
  const tmpImgEl = document.createElement('img');
  tmpImgEl.crossOrigin = 'Anonymous';
  return new Promise((resolve, reject) => {
    tmpImgEl.onload = () => {
      try {
        resolve(resizeAndExportImg(tmpImgEl));
      } catch (e) {
        reject(e);
      }
    };
    tmpImgEl.onerror = () => reject('Failed to load image from source.');
    tmpImgEl.src = src;
  });
}

/**
 * Crop the image and return a base64 bytes string of its content and compress it
 * if it exceeds the maximum size (default: 200KB).
 */
export function resizeAndExportImg(img: HTMLImageElement, maxSizeKB = 200): string {
  const MAX_WIDTH = 300;
  const MAX_HEIGHT = 300;

  let width = img.width;
  let height = img.height;

  // Change the resizing logic
  if (width > height) {
    if (width > MAX_WIDTH) {
      height *= MAX_WIDTH / width;
      width = MAX_WIDTH;
    }
  } else if (height > MAX_HEIGHT) {
    width *= MAX_HEIGHT / height;
    height = MAX_HEIGHT;
  }

  img.width = width;
  img.height = height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.drawImage(img, 0, 0, width, height);

  // return the .toDataURL of the temp canvas
  let dataUrl = canvas.toDataURL();

  let sizeInKB = getStringSizeInKB(dataUrl);
  if (sizeInKB < maxSizeKB) {
    return dataUrl;
  }

  // If it's too large, we try to compress it

  // Computes a compression that always decreases with a 10th of the current
  // order of magnitude, i.e. 0.9, 0.8, 0.7, ..., 0.1, 0.09, 0.08, ..., 0.01, 0.009, 0.008, ...
  const compressionAtStep = (n: number) => {
    if (n < 1) {
      throw new Error('Compression step must be a positive integer.');
    }
    const orderOfMagnitude = Math.ceil(n / 9);
    const positionInOrder = (n - 1) % 9;
    return (9 - positionInOrder) / Math.pow(10, orderOfMagnitude);
  };

  let n = 1;
  while (sizeInKB > maxSizeKB) {
    if (n > 20) {
      throw new Error('Image is too large.');
    }
    const compression = compressionAtStep(n);
    // console.log('Compressing at', compression);
    dataUrl = canvas.toDataURL('image/jpeg', compression);
    sizeInKB = getStringSizeInKB(dataUrl);
    n++;
  }

  canvas.remove();
  return dataUrl;
}

function getStringSizeInKB(str: string) {
  const blob = new Blob([str]);
  const sizeInBytes = blob.size;
  const sizeInKB = sizeInBytes / 1024;
  return sizeInKB;
}

/**
 *
 * @param iconSrc Takes an src attribute and if it's an SVG data url, encodes the svg part URI safe
 */
export function iconSrcURIEncodeSVG(iconSrc: string): string {
  if (iconSrc.startsWith('data:image/svg+xml;utf8,')) {
    return (
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(iconSrc.replace('data:image/svg+xml;utf8,', ''))
    );
  } else if (iconSrc.startsWith('data:image/svg+xml;')) {
    return 'data:image/svg+xml;' + encodeURIComponent(iconSrc.replace('data:image/svg+xml;', ''));
  }
  return iconSrc;
}

export function urlFromAppletHash(appletHash: AppletHash): string {
  const appletHashB64 = encodeHashToBase64(appletHash);
  const lowerCaseAppletId = toLowerCaseB64(appletHashB64);
  return lowerCaseAppletId.replaceAll('$', '%24');
}

export function notifyAndThrow(message: string) {
  notifyError(message);
  throw new Error(message);
}

export function validateWal(wal: WAL): WAL {
  if (!wal.hrl) throw new Error(`Got invalid WAL: ${JSON.stringify(wal)}`);
  if (wal.hrl.length !== 2 || wal.hrl[0].length !== 39 || wal.hrl[1].length !== 39)
    throw new Error(`Got invalid WAL: ${JSON.stringify(wal)}`);
  // TODO validate that the right keys are there
  return wal;
}

export function stringToMessageParts(input: string): Array<MessageContentPart> {
  const splitParts = input.split(/(uhCAk\S{48})/);
  return splitParts.map((part) => {
    return part.startsWith('uhCAk') && part.length === 53
      ? { type: 'agent', pubkey: part }
      : { type: 'text', content: part };
  });
}

export function refreshAllAppletIframes(appletId: AppletId): void {
  const appletIframes = getAllIframesFromApplet(appletId);
  appletIframes.forEach((iframe) => {
    iframe.src += '';
  });
}

function getAllIframesFromApplet(appletId: AppletId): HTMLIFrameElement[] {
  const allIframes = getAllIframes();
  return allIframes.filter((iframe) => iframe.src.startsWith(appletOriginFromAppletId(appletId)));
}

/**
 * Traverses the DOM to get all iframes. This actually only works for
 * "first-level" iframes, i.e. not for nested iframes and I think
 * that's because the DOM within an iframe cannot be accessed
 * due to CORS
 *
 * @returns
 */
export function getAllIframes() {
  const result: HTMLIFrameElement[] = [];

  // Recursive function to traverse the DOM tree
  function traverse(node) {
    // console.log('tagName of node: ', node.nodeName);
    // Check if the current node is an iframe
    if (node.tagName === 'IFRAME') {
      result.push(node);
    }

    // Get the shadow root of the node if available
    const shadowRoot = node.shadowRoot;

    // Traverse child nodes if any
    if (shadowRoot) {
      shadowRoot.childNodes.forEach(traverse);
    } else {
      node.childNodes.forEach(traverse);
    }
  }

  // Start traversing from the main document's body
  traverse(document.body);

  return result;
}

export function dateStr(timestamp: Timestamp) {
  const date = new Date(timestamp / 1000);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

export function progenitorFromProperties(properties: Uint8Array): AgentPubKeyB64 | null {
  const groupDnaProperties = decode(properties) as GroupDnaProperties;
  return groupDnaProperties.progenitor;
}

export function modifiersToInviteUrl(modifiers: DnaModifiers) {
  const groupDnaProperties = decode(modifiers.properties) as GroupDnaProperties;
  return `https://theweave.social/wal?weave-0.14://invite/${modifiers.network_seed}&progenitor=${groupDnaProperties.progenitor}`;
}

export async function groupModifiersToAppId(modifiers: DnaModifiers): Promise<InstalledAppId> {
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(modifiers.network_seed),
  );
  const hashArray = new Uint8Array(hashBuffer);
  const hashedSeed = Base64.fromUint8Array(hashArray);
  // const hashedSeed = hashArray.map((item) => item.toString(16).padStart(2, '0')).join('');
  const groupDnaProperties = decode(modifiers.properties) as GroupDnaProperties;
  return `group#${hashedSeed}#${groupDnaProperties.progenitor ? groupDnaProperties.progenitor : null}`;
}

export function markdownParseSafe(input: string) {
  const markedData = marked.parse(input) as string;
  return DOMPurify.sanitize(markedData);
}

export function lazyReloadableStore<T>(
  load: () => Promise<T>,
): AsyncReadable<T> & { reload: () => Promise<void> } {
  const store = writable<AsyncStatus<T>>({ status: 'pending' }, (set) => {
    load()
      .then((v) => {
        set({ status: 'complete', value: v });
      })
      .catch((e) => set({ status: 'error', error: e }));

    return () => {
      set({ status: 'pending' });
    };
  });

  const reload = async () => {
    try {
      const value = await load();
      store.set({
        status: 'complete',
        value,
      });
    } catch (error) {
      store.set({ status: 'error', error });
    }
  };

  return {
    subscribe: store.subscribe,
    reload,
  };
}

export function reloadableLazyLoadAndPollUntil<T>(
  load: () => Promise<T>,
  untilNot: any,
  pollIntervalMs: number,
  errDescription: string,
  firstLoad?: () => Promise<T>,
): AsyncReadable<T> & { reload: () => Promise<void> } {
  const store = writable<AsyncStatus<T>>({ status: 'pending' }, (set) => {
    let interval;
    let currentValue;
    let isFirstLoad = true;
    async function loadInner(): Promise<boolean> {
      let value;
      if (isFirstLoad && !!firstLoad) {
        value = await firstLoad();
      } else {
        value = await load();
      }
      if (isFirstLoad || !isEqual(value, currentValue)) {
        currentValue = value;
        isFirstLoad = false;
        set({ status: 'complete', value });
      }
      // The first load may fetch with GetOptions::Local so we still
      // want to poll one more time with GetOptions::Network in any case
      if (!isEqual(value, untilNot) && !isFirstLoad) {
        return false;
      }
      return true;
    }
    loadInner()
      .then((proceed) => {
        if (!proceed) return;
        interval = setInterval(() => {
          loadInner()
            .then((proceed) => {
              if (!proceed) clearInterval(interval);
            })
            .catch((e) => {
              console.warn(errDescription, e);
            });
        }, pollIntervalMs);
      })
      .catch((e) => {
        set({ status: 'error', error: e });
      });
    return () => {
      set({ status: 'pending' });
      if (interval) clearInterval(interval);
    };
  });

  const reload = async () => {
    try {
      const value = await load();
      store.set({
        status: 'complete',
        value,
      });
    } catch (error) {
      store.set({ status: 'error', error });
    }
  };

  return {
    subscribe: store.subscribe,
    reload,
  };
}

export function lazyLoadAndPollUntil<T>(
  load: () => Promise<T>,
  untilNot: any,
  pollIntervalMs: number,
  errDescription: string,
  firstLoad: () => Promise<T>,
): AsyncReadable<T> {
  return readable<AsyncStatus<T>>({ status: 'pending' }, (set) => {
    let interval;
    let currentValue;
    let isFirstLoad = true;
    async function loadInner(): Promise<boolean> {
      let value;
      if (isFirstLoad && !!firstLoad) {
        value = await firstLoad();
      } else {
        value = await load();
      }
      if (isFirstLoad || !isEqual(value, currentValue)) {
        currentValue = value;
        isFirstLoad = false;
        set({ status: 'complete', value });
      }
      // The first load may fetch with GetOptions::Local so we still
      // want to poll one more time with GetOptions::Network in any case
      if (!isEqual(value, untilNot) && !isFirstLoad) {
        return false;
      }
      return true;
    }
    loadInner()
      .then((proceed) => {
        if (!proceed) return;
        interval = setInterval(() => {
          loadInner()
            .then((proceed) => {
              if (!proceed) clearInterval(interval);
            })
            .catch((e) => {
              console.warn(errDescription, e);
            });
        }, pollIntervalMs);
      })
      .catch((e) => {
        set({ status: 'error', error: e });
      });
    return () => {
      set({ status: 'pending' });
      if (interval) clearInterval(interval);
    };
  });
}

export async function openWalInWindow(wal: WAL, mossStore: MossStore) {
  // determine iframeSrc, then open wal in window
  const location = await toPromise(mossStore.hrlLocations.get(wal.hrl[0]).get(wal.hrl[1]));
  if (!location) throw new Error('Asset not found.');
  const renderView: RenderView = {
    type: 'applet-view',
    view: {
      type: 'asset',
      wal,
      recordInfo: location.entryDefLocation
        ? {
            roleName: location.dnaLocation.roleName,
            integrityZomeName: location.entryDefLocation.integrity_zome,
            entryType: location.entryDefLocation.entry_def,
          }
        : undefined,
    },
  };
  const appletId = appletIdFromAppId(location.dnaLocation.appInfo.installed_app_id);
  const appletHash = decodeHashFromBase64(appletId);
  if (mossStore.isAppletDev) {
    const appId = appIdFromAppletId(appletId);
    const appletDevPort = await getAppletDevPort(appId);
    if (appletDevPort) {
      const iframeKind: IframeKind = {
        type: 'applet',
        appletHash,
        subType: 'asset',
      };
      const iframeSrc = `http://localhost:${appletDevPort}?${renderViewToQueryString(
        renderView,
      )}#${fromUint8Array(encode(iframeKind))}`;
      return window.electronAPI.openWalWindow(iframeSrc, appletId, wal);
    }
  }
  const iframeSrc = `${iframeOrigin({ type: 'applet', appletHash, subType: 'asset' })}?${renderViewToQueryString(renderView)}`;
  return window.electronAPI.openWalWindow(iframeSrc, appletId, wal);
}

export function UTCOffsetStringFromOffsetMinutes(offsetMinutes: number): string {
  const offsetHours = offsetMinutes / 60;
  if (offsetHours > 0) {
    return `UTC-${Math.abs(offsetHours)}`;
  }
  if (offsetHours < 0) {
    return `UTC+${Math.abs(offsetHours)}`;
  }
  return 'UTC';
}

export function relativeTzOffsetString(offsetMinutes1: number, offsetMinutes2: number): string {
  const delta = offsetMinutes2 - offsetMinutes1;
  const deltaHours = delta / 60;
  if (deltaHours < 0) {
    return `${deltaHours} hr ahead`;
  }
  if (deltaHours > 0) {
    return `${deltaHours} hr behind`;
  }
  return 'same timezone';
}

export function localTimeFromUtcOffset(offsetMinues: number): string {
  const utcNow = Date.now();
  const localNow = utcNow - offsetMinues * 60 * 1000;
  const localDate = new Date(localNow);
  const hours = localDate.getUTCHours();
  const minutes = localDate.getUTCMinutes();

  // Format the time in HH:MM format
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

export async function postMessageToIframe<T>(
  iframe: HTMLIFrameElement,
  message: ParentToAppletMessage,
) {
  return new Promise<T>((resolve, reject) => {
    const { port1, port2 } = new MessageChannel();

    if (iframe.contentWindow) {
      iframe.contentWindow!.postMessage(message, '*', [port2]);

      port1.onmessage = (m) => {
        if (m.data.type === 'success') {
          resolve(m.data.result);
        } else if (m.data.type === 'error') {
          reject(m.data.error);
        }
      };
    }
  });
}

/**
 * Creates tool library content based on the Tools specified in the dev config.
 *
 * @param config
 */
export function devModeToolLibraryFromDevConfig(config: WeaveDevConfig): {
  tools: ToolAndCurationInfo[];
  devCollective: DeveloperCollecive;
} {
  const devModeDeveloperCollective: DeveloperCollecive = {
    id: '###DEVCONFIG###',
    name: 'This Tool is listed in the dev config file.',
    description: 'Moss dev mode test dev collective',
    contact: {},
    icon: 'garbl',
  };

  // For testing purposes assign random visibility
  // const visibilities = ['high', 'low'];
  // let counter = 0;

  const tools: ToolAndCurationInfo[] = config.applets.map((toolConfig) => {
    let toolUrl: string;
    switch (toolConfig.source.type) {
      case 'filesystem':
        toolUrl = `file://${toolConfig.source.path}`;
        break;
      case 'https':
        toolUrl = toolConfig.source.url;
        break;
      case 'localhost':
        toolUrl = `file://${toolConfig.source.happPath}`;
        break;
    }
    const toolListUrl = `###DEVCONFIG###${toolConfig.source.type === 'localhost' ? toolConfig.source.uiPort : ''}`;
    const toolAndCurationInfo: ToolAndCurationInfo = {
      toolCompatibilityId: deriveToolCompatibilityId({
        toolListUrl: toolListUrl,
        toolId: toolConfig.name,
        versionBranch: '###DEVCONFIG###',
      }),
      developerCollectiveId: 'Moss dev mode test collective',
      toolListUrl: toolListUrl,
      curationInfos: [
        {
          info: {
            toolListUrl: toolListUrl,
            toolId: 'REPLACE',
            versionBranch: '###DEVCONFIG###',
            tags: ['some tag', 'another tag', 'cool', 'stuff'],
            // visiblity: visibilities[counter % 2] as 'high' | 'low',
          },
          curator: {
            name: 'Moss dev mode test curator',
            icon: 'asdfas',
            description: 'Moss dev mode test curator',
            contact: {},
          },
        },
      ],
      toolInfoAndVersions: {
        id: toolConfig.name,
        title: toolConfig.name,
        subtitle: toolConfig.subtitle,
        description: toolConfig.description,
        tags: [],
        versionBranch: '###DEVCONFIG###',
        icon:
          toolConfig.icon.type === 'filesystem'
            ? `file://${toolConfig.icon.path}`
            : toolConfig.icon.url,
        versions: [
          {
            version: '0.1.0',
            url: toolUrl,
            changelog: 'Same same. Just an example changelog.',
            releasedAt: Date.now(),
            hashes: {
              webhappSha256: '###DEVCONFIG###',
              happSha256: '###DEVCONFIG###',
              uiSha256: '###DEVCONFIG###',
            },
          },
        ],
      },
      latestVersion: {
        version: '0.1.0',
        url: toolUrl,
        changelog: 'Same same. Just an example changelog.',
        releasedAt: Date.now(),
        hashes: {
          webhappSha256: '###DEVCONFIG###',
          happSha256: '###DEVCONFIG###',
          uiSha256: '###DEVCONFIG###',
        },
      },
    };
    // counter += 1;
    return toolAndCurationInfo;
  });

  return {
    tools,
    devCollective: devModeDeveloperCollective,
  };
}

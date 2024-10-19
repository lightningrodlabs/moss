import {
  EntryHash,
  CellId,
  CellInfo,
  DisabledAppReason,
  AppInfo,
  AppWebsocket,
  ListAppsResponse,
  DnaHash,
  CellType,
  encodeHashToBase64,
  ClonedCell,
  DnaHashB64,
  decodeHashFromBase64,
  CallZomeRequest,
  FunctionName,
  ZomeName,
  AgentPubKeyB64,
  Timestamp,
  AppAuthenticationToken,
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
} from '@theweave/api';
import { GroupDnaProperties } from '@theweave/group-client';
import { decode, encode } from '@msgpack/msgpack';
import { Base64, fromUint8Array, toUint8Array } from 'js-base64';
import isEqual from 'lodash-es/isEqual.js';

import { AppletNotificationSettings, NotificationSettings } from './applets/types.js';
import { MessageContentPart } from './types.js';
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
import { appIdFromAppletId, toLowerCaseB64 } from '@theweave/utils';

export async function initAppClient(
  token: AppAuthenticationToken,
  defaultTimeout?: number,
): Promise<AppWebsocket> {
  const client = await AppWebsocket.connect({
    token,
    defaultTimeout,
  });
  client.cachedAppInfo = undefined;
  await client.appInfo();
  return client;
}

export function appletOrigin(appletHash: AppletHash): string {
  return `applet://${toLowerCaseB64(encodeHashToBase64(appletHash))}`;
}

export function appletOriginFromAppletId(appletId: AppletId): string {
  return `applet://${toLowerCaseB64(appletId)}`;
}

export function findAppForDnaHash(
  apps: ListAppsResponse,
  dnaHash: DnaHash,
): { appInfo: AppInfo; roleName: string } | undefined {
  for (const app of apps) {
    for (const [roleName, cells] of Object.entries(app.cell_info)) {
      for (const cell of cells) {
        if (CellType.Cloned in cell) {
          if (cell[CellType.Cloned].cell_id[0].toString() === dnaHash.toString()) {
            return { appInfo: app, roleName };
          }
        } else if (CellType.Provisioned in cell) {
          if (cell[CellType.Provisioned].cell_id[0].toString() === dnaHash.toString()) {
            return { appInfo: app, roleName };
          }
        }
      }
    }
  }
  return undefined;
}

export function fakeMd5SeededEntryHash(md5Hash: Uint8Array): EntryHash {
  return new Uint8Array([0x84, 0x21, 0x24, ...md5Hash, ...new Uint8Array(20)]);
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
  return app.status === 'running';
}
export function isAppDisabled(app: AppInfo): boolean {
  return Object.keys(app.status).includes('disabled');
}
export function isAppPaused(app: AppInfo): boolean {
  return Object.keys(app.status).includes('paused');
}
export function getReason(app: AppInfo): string | undefined {
  if (isAppRunning(app)) return undefined;
  if (isAppDisabled(app)) {
    const reason = (
      app.status as unknown as {
        disabled: {
          reason: DisabledAppReason;
        };
      }
    ).disabled.reason;

    if ((reason as any) === 'never_started') {
      return 'App was never started';
    } else if ((reason as any) === 'user') {
      return 'App was disabled by the user';
    } else {
      return `There was an error with this app: ${
        (
          reason as {
            error: string;
          }
        ).error
      }`;
    }
  } else {
    return (
      app.status as unknown as {
        paused: { reason: { error: string } };
      }
    ).paused.reason.error;
  }
}

export function getCellId(cellInfo: CellInfo): CellId | undefined {
  if ('provisioned' in cellInfo) {
    return cellInfo.provisioned.cell_id;
  }
  if ('cloned' in cellInfo) {
    return cellInfo.cloned.cell_id;
  }
  return undefined;
}

export function getCellName(cellInfo: CellInfo): string | undefined {
  if ('provisioned' in cellInfo) {
    return cellInfo.provisioned.name;
  }
  if ('cloned' in cellInfo) {
    return cellInfo.cloned.name;
  }
  if ('stem' in cellInfo) {
    return cellInfo.stem.name;
  }
  return undefined;
}

export function getCellNetworkSeed(cellInfo: CellInfo): string | undefined {
  if ('provisioned' in cellInfo) {
    return cellInfo.provisioned.dna_modifiers.network_seed;
  }
  if ('cloned' in cellInfo) {
    return cellInfo.cloned.dna_modifiers.network_seed;
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
    .filter(([_roleName, cellInfo]) => 'provisioned' in cellInfo)
    .sort(([roleName_a, _cellInfo_a], [roleName_b, _cellInfo_b]) =>
      roleName_a.localeCompare(roleName_b),
    );
  return provisionedCells;
}

export function getEnabledClonedCells(appInfo: AppInfo): [string, CellInfo][] {
  return flattenCells(appInfo.cell_info)
    .filter(([_roleName, cellInfo]) => 'cloned' in cellInfo)
    .filter(
      ([_roleName, cellInfo]) => (cellInfo as { [CellType.Cloned]: ClonedCell }).cloned.enabled,
    )
    .sort(([roleName_a, _cellInfo_a], [roleName_b, _cellInfo_b]) =>
      roleName_a.localeCompare(roleName_b),
    );
}

export function getDisabledClonedCells(appInfo: AppInfo): [string, CellInfo][] {
  return flattenCells(appInfo.cell_info)
    .filter(([_roleName, cellInfo]) => 'cloned' in cellInfo)
    .filter(
      ([_roleName, cellInfo]) => !(cellInfo as { [CellType.Cloned]: ClonedCell }).cloned.enabled,
    )
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

export function stringifyWal(wal: WAL): string {
  return fromUint8Array(encode(wal));
}

export function deStringifyWal(walStringified: string): WAL {
  return decode(toUint8Array(walStringified)) as WAL;
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

// Crop the image and return a base64 bytes string of its content
export function resizeAndExport(img: HTMLImageElement) {
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

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.drawImage(img, 0, 0, width, height);

  // return the .toDataURL of the temp canvas
  return canvas.toDataURL();
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

export function getAllIframesFromApplet(appletId: AppletId): HTMLIFrameElement[] {
  const allIframes = getAllIframes();
  return allIframes.filter((iframe) => iframe.src.startsWith(appletOriginFromAppletId(appletId)));
}

export function getAllIframes() {
  const result: HTMLIFrameElement[] = [];

  // Recursive function to traverse the DOM tree
  function traverse(node) {
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

export function logAppletZomeCall(request: CallZomeRequest, appletId: AppletId) {
  if ((window as any).__ZOME_CALL_LOGGING_ENABLED__) {
    const zomeCallCounts = window[`__appletZomeCallCount_${appletId}`];
    if (zomeCallCounts) {
      zomeCallCounts.totalCounts += 1;
      if (zomeCallCounts.functionCalls[request.fn_name]) {
        zomeCallCounts.functionCalls[request.fn_name] += 1;
      } else {
        if (!zomeCallCounts.functionCalls) {
          zomeCallCounts.functionCalls = {};
        }
        zomeCallCounts.functionCalls[request.fn_name] = 1;
      }
      window[`__appletZomeCallCount_${appletId}`] = zomeCallCounts;
    } else {
      window[`__appletZomeCallCount_${appletId}`] = {
        firstCall: Date.now(),
        totalCounts: 1,
        functionCalls: {
          [request.fn_name]: 1,
        },
      };
    }
  }
}

/**
 * Zome calls made by non-applet dnas
 *
 * @param request
 * @param appletId
 */
export function logMossZomeCall(
  cellId: [DnaHashB64, AgentPubKeyB64],
  fnName: FunctionName,
  _zomeName: ZomeName,
) {
  if ((window as any).__ZOME_CALL_LOGGING_ENABLED__) {
    // We assume unique dna hashes for now
    const zomeCallCounts = window[`__mossZomeCallCount_${cellId[0]}`];
    if (zomeCallCounts) {
      zomeCallCounts.totalCounts += 1;
      if (zomeCallCounts.functionCalls[fnName]) {
        zomeCallCounts.functionCalls[fnName] += 1;
      } else {
        if (!zomeCallCounts.functionCalls) {
          zomeCallCounts.functionCalls = {};
        }
        zomeCallCounts.functionCalls[fnName] = 1;
      }
      window[`__mossZomeCallCount_${cellId[0]}`] = zomeCallCounts;
    } else {
      window[`__mossZomeCallCount_${cellId[0]}`] = {
        firstCall: Date.now(),
        totalCounts: 1,
        functionCalls: {
          [fnName]: 1,
        },
      };
    }
  }
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
  return `https://theweave.social/wal?weave-0.13://invite/${modifiers.network_seed}&progenitor=${groupDnaProperties.progenitor}`;
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
): AsyncReadable<T> & { reload: () => Promise<void> } {
  const store = writable<AsyncStatus<T>>({ status: 'pending' }, (set) => {
    let interval;
    let currentValue;
    let firstLoad = true;
    async function loadInner(): Promise<boolean> {
      const value = await load();
      if (firstLoad || !isEqual(value, currentValue)) {
        currentValue = value;
        firstLoad = false;
        set({ status: 'complete', value });
      }
      if (!isEqual(value, untilNot)) {
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
            .catch(() => {});
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
): AsyncReadable<T> {
  return readable<AsyncStatus<T>>({ status: 'pending' }, (set) => {
    let interval;
    let currentValue;
    let firstLoad = true;
    async function loadInner(): Promise<boolean> {
      const value = await load();
      if (firstLoad || !isEqual(value, currentValue)) {
        currentValue = value;
        firstLoad = false;
        set({ status: 'complete', value });
      }
      if (!isEqual(value, untilNot)) {
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
            .catch(() => {});
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

export async function openWalInWindow(wal: WAL, appletId: AppletId, mossStore: MossStore) {
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
  const appletHash = decodeHashFromBase64(appletId);
  if (mossStore.isAppletDev) {
    const appId = appIdFromAppletId(appletId);
    const appletDevPort = await getAppletDevPort(appId);
    if (appletDevPort) {
      const iframeSrc = `http://localhost:${appletDevPort}?${renderViewToQueryString(
        renderView,
      )}#${urlFromAppletHash(appletHash)}`;
      return window.electronAPI.openWalWindow(iframeSrc, appletId, wal);
    }
  }
  const iframeSrc = `${appletOrigin(appletHash)}?${renderViewToQueryString(renderView)}`;
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

/**
 * Posts a message to all iframes of the specified AppletIds and returns the settled promises.
 * This includes iframes of assets associated to the AppletIds, not only the main view.
 *
 * TODO: Add option to only target main view or specific views
 *
 * @param appletIds
 * @param message
 * @returns
 */
export async function postMessageToAppletIframes(
  appletIds: { type: 'all' } | { type: 'some'; ids: AppletId[] },
  message: ParentToAppletMessage,
  extraOrigins?: Array<string>,
) {
  const allIframes = getAllIframes();
  let allAppletIframes = allIframes.filter(
    (iframe) => iframe.src.startsWith('applet://') || iframe.src.startsWith('http://localhost'),
  );
  if (appletIds.type === 'some') {
    const relevantSrcs = appletIds.ids.map((id) => appletOriginFromAppletId(id));
    allAppletIframes = allAppletIframes.filter((iframe) => {
      let matches = false;
      if (extraOrigins) {
        extraOrigins.forEach((origin) => {
          if (iframe.src.startsWith(origin)) {
            matches = true;
          }
        });
      }
      relevantSrcs.forEach((origin) => {
        if (iframe.src.startsWith(origin)) {
          matches = true;
        }
      });
      return matches;
    });
  }
  console.log(
    'Sending postMessate to the following iframes: ',
    allAppletIframes.map((iframe) => iframe.src),
  );

  return Promise.allSettled(
    allAppletIframes.map(async (iframe) => {
      await postMessageToIframe(iframe, message);
    }),
  );
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

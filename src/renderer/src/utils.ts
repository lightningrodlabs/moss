import {
  EntryHash,
  CellId,
  CellInfo,
  DisabledAppReason,
  AppInfo,
  AppAgentWebsocket,
  ListAppsResponse,
  DnaHash,
  CellType,
  encodeHashToBase64,
  ClonedCell,
  DnaHashB64,
  decodeHashFromBase64,
  HoloHashB64,
  ActionHash,
} from '@holochain/client';
import {
  Hrl,
  HrlB64WithContext,
  HrlWithContext,
  RenderView,
  WeNotification,
} from '@lightningrodlabs/we-applet';
import { encode } from '@msgpack/msgpack';
import { fromUint8Array } from 'js-base64';

import { AppletNotificationSettings } from './applets/types.js';
import { AppletHash, AppletId, DistributionInfo } from './types.js';

export async function initAppClient(
  appId: string,
  defaultTimeout?: number,
): Promise<AppAgentWebsocket> {
  const client = await AppAgentWebsocket.connect(new URL('ws://UNUSED'), appId, defaultTimeout);
  client.installedAppId = appId;
  client.cachedAppInfo = undefined;
  client.appWebsocket.overrideInstalledAppId = appId;
  await client.appInfo();
  return client;
}

export function appletOrigin(appletHash: AppletHash): string {
  return `applet://${toLowerCaseB64(encodeHashToBase64(appletHash))}`;
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

// IMPORTANT: If this function is changed, the same function in utils/applet-iframe/index.ts needs
// to be changed accordingly
export function appIdFromAppletHash(appletHash: AppletHash): string {
  return `applet#${toLowerCaseB64(encodeHashToBase64(appletHash))}`;
}

export function appIdFromAppletId(appletId: AppletId): string {
  return `applet#${toLowerCaseB64(appletId)}`;
}

export function appletHashFromAppId(installedAppId: string): AppletHash {
  return decodeHashFromBase64(toOriginalCaseB64(installedAppId.slice(7)));
}

export function appletIdFromAppId(installedAppId: string): AppletId {
  return toOriginalCaseB64(installedAppId.slice(7));
}

export function toLowerCaseB64(hashb64: HoloHashB64): string {
  return hashb64.replace(/[A-Z]/g, (match) => match.toLowerCase() + '$');
}

export function toOriginalCaseB64(input: string): HoloHashB64 {
  return input.replace(/[a-z]\$/g, (match) => match[0].toUpperCase());
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
  return Object.keys(app.status).includes('running');
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

export function validateNotifications(notifications: Array<WeNotification>): void {
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
 * Stores applet notifications to localStorage - to the array of unread notifications
 * as well as to a persistent (deduplicated) log of all received notifications
 *
 * @param notifications
 * @param appletId
 * @returns
 */
export function storeAppletNotifications(
  notifications: Array<WeNotification>,
  appletId: AppletId,
): Array<WeNotification> {
  // store them to unread messages
  const unreadNotificationsJson: string | null = window.localStorage.getItem(
    `appletNotificationsUnread#${appletId}`,
  );
  let unreadNotifications: Array<WeNotification>;

  if (unreadNotificationsJson) {
    unreadNotifications = JSON.parse(unreadNotificationsJson);
    unreadNotifications = [...new Set([...unreadNotifications, ...notifications])]; // dedpulicated array
  } else {
    unreadNotifications = [...notifications];
  }

  window.localStorage.setItem(
    `appletNotificationsUnread#${appletId}`,
    JSON.stringify(unreadNotifications),
  );

  // store to persistend time-indexed notifications log
  notifications.forEach((notification) => {
    const timestamp = notification.timestamp;
    const daysSinceEpoch = Math.floor(timestamp / 8.64e7);
    const notificationsOfSameDateJSON: string | null = window.localStorage.getItem(
      `appletNotifications#${daysSinceEpoch}#${appletId}`,
    );
    let notificationsOfSameDate: Array<WeNotification>;
    if (notificationsOfSameDateJSON) {
      notificationsOfSameDate = JSON.parse(notificationsOfSameDateJSON);
      notificationsOfSameDate = [...new Set([...notificationsOfSameDate, notification])];
    } else {
      notificationsOfSameDate = [notification];
    }
    window.localStorage.setItem(
      `appletNotifications#${daysSinceEpoch}#${appletId}`,
      JSON.stringify(notificationsOfSameDate),
    );
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
  const unreadNotificationsJson: string | null = window.localStorage.getItem(
    `appletNotificationsUnread#${appletId}`,
  );
  let unreadNotifications: Array<WeNotification>;

  if (unreadNotificationsJson) {
    unreadNotifications = JSON.parse(unreadNotificationsJson);
    return getNotificationState(unreadNotifications);
  } else {
    return [undefined, undefined];
  }
}

/**
 * Reads the current applet notification states from localStorage
 *
 * @returns
 */
export function loadAllNotificationStates(): Record<
  AppletId,
  [string | undefined, number | undefined]
> {
  const states = {};
  Object.keys(localStorage).forEach((key) => {
    if (key.includes('appletNotificationsUnread#')) {
      const appletId = key.slice(26);
      states[appletId] = loadAppletNotificationStatus(appletId);
    }
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
  unreadNotifications: Array<WeNotification>,
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
  window.localStorage.setItem(`appletNotificationsUnread#${appletId}`, JSON.stringify([]));
}

/**
 * Gets the user-defined notification settings for the specified applet Id from localStorage
 * @param appletId
 * @returns
 */
export function getAppletNotificationSettings(appletId: AppletId): AppletNotificationSettings {
  const appletNotificationSettingsJson: string | null = window.localStorage.getItem(
    `appletNotificationSettings#${appletId}`,
  );
  const appletNotificationSettings: AppletNotificationSettings = appletNotificationSettingsJson
    ? JSON.parse(appletNotificationSettingsJson)
    : {
        allowOSNotification: true,
        showInSystray: true,
        showInGroupSidebar: true,
        showInAppletSidebar: true,
        showInGroupHomeFeed: true,
      };

  return appletNotificationSettings;
}

export function hrlWithContextToB64(hrl: HrlWithContext): HrlB64WithContext {
  return {
    hrl: [encodeHashToBase64(hrl.hrl[0]), encodeHashToBase64(hrl.hrl[1])],
    context: hrl.context,
  };
}

export function hrlB64WithContextToRaw(hrlB64: HrlB64WithContext): HrlWithContext {
  return {
    hrl: [decodeHashFromBase64(hrlB64.hrl[0]), decodeHashFromBase64(hrlB64.hrl[1])],
    context: hrlB64.context,
  };
}

export function renderViewToQueryString(renderView: RenderView): string {
  let base = `view=${renderView.type}`;

  if (renderView.view) {
    base = `view=${renderView.type}&view-type=${renderView.view.type}`;

    if ('block' in renderView.view) {
      base = `${base}&block=${renderView.view.block}`;
    }
    if ('hrl' in renderView.view) {
      base = `${base}&hrl=${stringifyHrl(renderView.view.hrl)}`;
    }
    if ('context' in renderView.view) {
      const b64context = fromUint8Array(encode(renderView.view.context), true);
      base = `${base}&context=${b64context}`;
    }
  }

  return base;
}

export function stringifyHrl(hrl: Hrl): string {
  return `hrl://${encodeHashToBase64(hrl[0])}/${encodeHashToBase64(hrl[1])}`;
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

export function appEntryActionHashFromDistInfo(distributionInfoString: string): ActionHash {
  const distributionInfo: DistributionInfo = JSON.parse(distributionInfoString);
  if (distributionInfo.type !== 'appstore-light')
    throw new Error("Cannot get AppEntry action hash from type other than 'appstore-light'.");
  return decodeHashFromBase64(distributionInfo.info.appEntryActionHash);
}

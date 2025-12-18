import {
  AsyncReadable,
  Writable,
  derived,
  lazyLoad,
  lazyLoadAndPoll,
  pipe,
  writable,
} from '@holochain-open-dev/stores';
import { AppAuthenticationToken, encodeHashToBase64 } from '@holochain/client';
import { AppletHash, BlockType } from '@theweave/api';

import { AppletHost } from './applet-host.js';
import {
  clearAppletNotificationStatus,
  getAllIframes,
  loadAppletNotificationStatus,
} from '../utils.js';
import { ConductorInfo } from '../electron-api.js';
import { Applet } from '@theweave/group-client';

/**
 * Applet = Tool + DnaModifiers
 * Used by one or multiple groups since different groups can use the same dnaModifiers
 * */
export class AppletStore {
  isAppletDev: boolean;

  constructor(
    public appletHash: AppletHash,
    public applet: Applet,
    public conductorInfo: ConductorInfo,
    public authenticationToken: AppAuthenticationToken,
    isAppletDev: boolean,
  ) {
    this._unreadNotifications.set(loadAppletNotificationStatus(appletHash));
    this.isAppletDev = isAppletDev;
  }

  host: AsyncReadable<AppletHost | undefined> = lazyLoad(async () => {
    const appletId = encodeHashToBase64(this.appletHash);
    const allIframes = getAllIframes();
    const relevantIframe = allIframes.find((iframe) => iframe.id === appletId);
    if (relevantIframe && relevantIframe.contentWindow) {
      return new AppletHost(relevantIframe, appletId);
    } else {
      return new Promise<AppletHost | undefined>((resolve) => {
        setTimeout(() => {
          const allIframes = getAllIframes();
          const relevantIframe = allIframes.find((iframe) => iframe.id === appletId);
          if (relevantIframe && relevantIframe.contentWindow) {
            resolve(new AppletHost(relevantIframe, appletId));
          } else {
            console.warn(
              `Connecting to applet host for applet ${appletId} timed out in 10000ms`,
            );
          }
          resolve(undefined);
        }, 10000);
      });
    }
  });

  blocks: AsyncReadable<Record<string, BlockType>> = pipe(this.host, (host) =>
    lazyLoadAndPoll(() => (host ? host.getBlocks() : Promise.resolve({})), 10000),
  );

  _unreadNotifications: Writable<[string | undefined, number | undefined]> = writable([
    undefined,
    undefined,
  ]);

  unreadNotifications() {
    return derived(this._unreadNotifications, (store) => store);
  }

  setUnreadNotifications(unreadNotifications: [string | undefined, number | undefined]) {
    this._unreadNotifications.set(unreadNotifications);
  }

  clearNotificationStatus() {
    clearAppletNotificationStatus(encodeHashToBase64(this.appletHash));
    this._unreadNotifications.set([undefined, undefined]);
  }
}

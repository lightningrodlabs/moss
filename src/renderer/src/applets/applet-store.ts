import {
  AsyncReadable,
  Writable,
  derived,
  lazyLoad,
  lazyLoadAndPoll,
  pipe,
  writable,
} from '@holochain-open-dev/stores';
import { AppAuthenticationToken, encodeHashToBase64, EntryHash } from '@holochain/client';
import { BlockType } from '@theweave/api';

import { AppletHost } from './applet-host.js';
import {
  clearAppletNotificationStatus,
  getAllIframes,
  loadAppletNotificationStatus,
} from '../utils.js';
import { ConductorInfo } from '../electron-api.js';
import { Applet } from '@theweave/group-client';

export class AppletStore {
  isAppletDev: boolean;

  constructor(
    public appletHash: EntryHash,
    public applet: Applet,
    public conductorInfo: ConductorInfo,
    public authenticationToken: AppAuthenticationToken,
    isAppletDev: boolean,
  ) {
    this._unreadNotifications.set(loadAppletNotificationStatus(encodeHashToBase64(appletHash)));
    this.isAppletDev = isAppletDev;
  }

  host: AsyncReadable<AppletHost | undefined> = lazyLoad(async () => {
    const appletHashBase64 = encodeHashToBase64(this.appletHash);
    const allIframes = getAllIframes();
    const relevantIframe = allIframes.find((iframe) => iframe.id === appletHashBase64);
    if (relevantIframe && relevantIframe.contentWindow) {
      return new AppletHost(relevantIframe, appletHashBase64);
    } else {
      return new Promise<AppletHost | undefined>((resolve) => {
        setTimeout(() => {
          const allIframes = getAllIframes();
          const relevantIframe = allIframes.find((iframe) => iframe.id === appletHashBase64);
          if (relevantIframe && relevantIframe.contentWindow) {
            resolve(new AppletHost(relevantIframe, appletHashBase64));
          } else {
            console.warn(
              `Connecting to applet host for applet ${appletHashBase64} timed out in 10000ms`,
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

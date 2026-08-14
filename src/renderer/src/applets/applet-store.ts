import { AsyncReadable, Writable, derived, lazyLoad, writable } from '@holochain-open-dev/stores';
import { AppAuthenticationToken, encodeHashToBase64, EntryHash } from '@holochain/client';

import { AppletHost } from './applet-host.js';
import {
  clearAppletNotificationStatus,
  getAllIframes,
  loadAppletNotificationStatus,
} from '../utils.js';
import { ConductorInfo } from '../electron-api.js';
import { Applet } from '@theweave/group-client';
import { IframeStore } from '../iframe-store.js';

/**
 * How long to wait for an applet's main iframe to report that it can answer
 * messages. It covers the full iframe bootstrap, including the app websocket
 * connections that the applet sets up before registering its message handlers.
 */
const IFRAME_READY_TIMEOUT_MS = 20000;

export class AppletStore {
  isAppletDev: boolean;

  constructor(
    public appletHash: EntryHash,
    public applet: Applet,
    public conductorInfo: ConductorInfo,
    public authenticationToken: AppAuthenticationToken,
    isAppletDev: boolean,
    public iframeStore: IframeStore,
  ) {
    this._unreadNotifications.set(loadAppletNotificationStatus(encodeHashToBase64(appletHash)));
    this.isAppletDev = isAppletDev;
  }

  host: AsyncReadable<AppletHost | undefined> = lazyLoad(async () => {
    const appletHashBase64 = encodeHashToBase64(this.appletHash);
    const readyIframe = await this.iframeStore.waitForReadyAppletIframe(
      appletHashBase64,
      'main',
      IFRAME_READY_TIMEOUT_MS,
    );
    if (readyIframe && readyIframe.source && readyIframe.source !== 'wal-window') {
      return new AppletHost(readyIframe.source, appletHashBase64);
    }

    // An iframe that never reports readiness should still be reachable, so fall
    // back to whatever is in the DOM. Messages to it may go unanswered, which
    // the postMessage timeout reports.
    const relevantIframe = getAllIframes().find((iframe) => iframe.id === appletHashBase64);
    if (relevantIframe && relevantIframe.contentWindow) {
      console.warn(
        `Applet ${appletHashBase64} did not report readiness within ${IFRAME_READY_TIMEOUT_MS}ms. Falling back to its iframe in the DOM.`,
      );
      return new AppletHost(relevantIframe.contentWindow, appletHashBase64);
    }

    console.warn(
      `Connecting to applet host for applet ${appletHashBase64} timed out in ${IFRAME_READY_TIMEOUT_MS}ms`,
    );
    return undefined;
  });

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

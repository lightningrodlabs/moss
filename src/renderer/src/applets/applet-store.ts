import {
  AsyncReadable,
  Writable,
  derived,
  lazyLoad,
  lazyLoadAndPoll,
  pipe,
  writable,
} from '@holochain-open-dev/stores';
import { encodeHashToBase64, EntryHash } from '@holochain/client';
import {
  AppletToParentMessage,
  BlockType,
  InternalAttachmentType,
  RenderView,
} from '@lightningrodlabs/we-applet';

import { AppletHost } from './applet-host.js';
import { Applet } from './types.js';
import {
  appEntryIdFromDistInfo,
  appIdFromAppletHash,
  appletOrigin,
  clearAppletNotificationStatus,
  loadAppletNotificationStatus,
  renderViewToQueryString,
  urlFromAppletHash,
} from '../utils.js';
import { ConductorInfo, getAppletDevPort } from '../electron-api.js';
import { AppletBundlesStore } from '../applet-bundles/applet-bundles-store.js';

export class AppletStore {
  isAppletDev: boolean;

  constructor(
    public appletHash: EntryHash,
    public applet: Applet,
    public conductorInfo: ConductorInfo,
    public appletBundlesStore: AppletBundlesStore,
    isAppletDev: boolean,
  ) {
    this._unreadNotifications.set(loadAppletNotificationStatus(encodeHashToBase64(appletHash)));
    this.isAppletDev = isAppletDev;
  }

  host: AsyncReadable<AppletHost | undefined> = lazyLoad(async () => {
    const appletHashBase64 = encodeHashToBase64(this.appletHash);

    let iframe = document.getElementById(appletHashBase64) as HTMLIFrameElement | undefined;
    if (iframe) {
      return new AppletHost(iframe, appletHashBase64);
    }

    const renderView: RenderView = {
      type: 'background-service',
      view: null,
    };

    let iframeSrc: string;

    if (this.isAppletDev) {
      const appId = appIdFromAppletHash(this.appletHash);
      const appletDevPort = await getAppletDevPort(appId);
      if (appletDevPort) {
        // UI running on localhost
        iframeSrc = `http://localhost:${appletDevPort}?${renderViewToQueryString(
          renderView,
        )}#${urlFromAppletHash(this.appletHash)}`;
      } else {
        // UI from filesystem
        iframeSrc = `${appletOrigin(this.appletHash)}?${renderViewToQueryString(renderView)}`;
      }
    } else {
      iframeSrc = `${appletOrigin(this.appletHash)}?${renderViewToQueryString(renderView)}`;
    }

    iframe = document.createElement('iframe');
    iframe.id = appletHashBase64;
    iframe.src = iframeSrc;
    iframe.style.display = 'none';

    document.body.appendChild(iframe);

    return new Promise<AppletHost | undefined>((resolve) => {
      const timeOut = setTimeout(() => {
        console.warn(
          `Connecting to applet host for applet ${appletHashBase64} timed out in 10000ms`,
        );
        resolve(undefined);
      }, 10000);

      window.addEventListener('message', (message) => {
        if (message.source === iframe?.contentWindow) {
          if ((message.data as AppletToParentMessage).request.type === 'ready') {
            clearTimeout(timeOut);
            resolve(new AppletHost(iframe!, appletHashBase64));
          }
        }
      });
    });
  });

  attachmentTypes: AsyncReadable<Record<string, InternalAttachmentType>> = pipe(this.host, (host) =>
    lazyLoadAndPoll(async () => {
      if (!host) return Promise.resolve({});
      try {
        const attachmentTypes = await host.getAppletAttachmentTypes();
        return attachmentTypes;
      } catch (e) {
        console.warn(`Failed to get attachment types from applet "${host.appletId}": ${e}`);
        return Promise.resolve({});
      }
    }, 10000),
  );

  blocks: AsyncReadable<Record<string, BlockType>> = pipe(this.host, (host) =>
    lazyLoadAndPoll(() => (host ? host.getBlocks() : Promise.resolve({})), 10000),
  );

  logo = this.appletBundlesStore.appletBundleLogo.get(
    appEntryIdFromDistInfo(this.applet.distribution_info),
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

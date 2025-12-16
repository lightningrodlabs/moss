import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { mossStyles } from './shared-styles';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import {
  AppletHash,
  AppletId,
  AppletInfo,
  AppletToParentMessage,
  AssetLocationAndInfo,
  GroupProfile,
  ParentToAppletMessage,
  WAL,
} from '@theweave/api';
import {
    CallZomeRequest,
    CallZomeRequestSigned,
    decodeHashFromBase64, DnaHash, DnaHashB64,
    encodeHashToBase64,
} from '@holochain/client';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import { IframeStore } from './iframe-store';
import { getIframeKind } from './applets/applet-host';

// import { ipcRenderer } from 'electron';

type ParentToAppletMessagePayload = {
  message: ParentToAppletMessage;
  forApplets: AppletId[];
};

// IPC_CHANGE here
declare global {
  interface Window {
    __WINDOW_CLOSING__: boolean | undefined;
  }
  interface WALWindow {
    electronAPI: {
      appletMessageToParent: (message: AppletToParentMessage) => Promise<any>;
      closeWindow: () => Promise<void>;
      focusMainWindow: () => Promise<void>;
      focusMyWindow: () => Promise<void>;
      getMySrc: () => Promise<
        | {
            iframeSrc: string;
            appletId: AppletId;
            groupId: DnaHashB64,
            wal: WAL;
          }
        | undefined
      >;
      isAppletDev: () => Promise<boolean>;
      onWindowClosing: (callback: (e: Electron.IpcRendererEvent) => any) => void;
      onWillNavigateExternal: (callback: (e: any) => any) => void;
      removeWillNavigateListeners: () => void;
      onParentToAppletMessage: (
        callback: (e: Electron.IpcRendererEvent, payload: ParentToAppletMessagePayload) => any,
      ) => void;
      onRequestIframeStoreSync: (callback: (e: Electron.IpcRendererEvent) => any) => void;
      iframeStoreSync: (storeContent) => void;
      selectScreenOrWindow: () => Promise<string>;
      setMyIcon: (icon: string) => Promise<void>;
      setMyTitle: (title: string) => Promise<void>;
      signZomeCallApplet: (request: CallZomeRequest) => Promise<CallZomeRequestSigned>;
    };
  }
}

const walWindow = window as unknown as WALWindow;

@localized()
@customElement('wal-window')
export class WalWindow extends LitElement {
  iframeStore = new IframeStore();

  isAppletDev: boolean | undefined;

  @state()
  iframeSrc: string | undefined;

  @state()
  appletHash: AppletHash | undefined;

  @state()
  groupHash: DnaHash | undefined;

  @state()
  loading: string | undefined = msg('loading...');

  @state()
  slowLoading = false;

  @state()
  slowReloadTimeout: number | undefined;

  @state()
  onBeforeUnloadHandler: ((e) => Promise<void>) | undefined;

  @state()
  shouldClose = false;

  beforeUnloadListener = async (e) => {
    // Wait first to check whether it's triggered by a will-navigate or will-frame-navigate
    // event to an external location (https, mailto, ...) and this listener should therefore
    // not be executed (https://github.com/electron/electron/issues/29921)
    let shouldProceed = true;
    await new Promise((resolve) => {
      window.electronAPI.onWillNavigateExternal(() => {
        shouldProceed = false;
        window.electronAPI.removeWillNavigateListeners();
        resolve(null);
      });
      setTimeout(() => {
        resolve(null);
      }, 500);
    });

    if (shouldProceed) {
      e.preventDefault();
      console.log('onbeforeunload event');
      this.loading = 'Saving...';
      // If it takes longer than 5 seconds to unload, offer to hard reload
      this.slowReloadTimeout = window.setTimeout(() => {
        this.slowLoading = true;
      }, 4500);
      await this.iframeStore.postMessageToAppletIframes(
        { type: 'all' },
        { type: 'on-before-unload' },
      );
      console.log('on-before-unload callbacks finished.');
      window.removeEventListener('beforeunload', this.beforeUnloadListener);
      // The logic to set this variable lives in walwindow.html
      if (window.__WINDOW_CLOSING__) {
        console.log('__WINDOW_CLOSING__ is true.');
        walWindow.electronAPI.closeWindow();
      } else {
        window.location.reload();
      }
    }
  };

  async firstUpdated() {
    // add the beforeunload listener only 5 seconds later as there won't be anything
    // meaningful to save by applets before and it will ensure that the iframes
    // are ready to respond to the on-before-reload event
    setTimeout(() => {
      window.addEventListener('beforeunload', this.beforeUnloadListener);
    }, 5000);

    walWindow.electronAPI.onParentToAppletMessage(async (_e, { message, forApplets }) => {
      await this.iframeStore.postMessageToAppletIframes({ type: 'some', ids: forApplets }, message);
    });

    walWindow.electronAPI.onRequestIframeStoreSync(async () => {
      const storeContent = [this.iframeStore.appletIframes, this.iframeStore.crossGroupIframes];
      await walWindow.electronAPI.iframeStoreSync(storeContent);
    });

    // set up handler to handle iframe messages
    window.addEventListener('message', async (message: MessageEvent<AppletToParentMessage>) => {
      const request = message.data;

      const handleRequest = async (request: AppletToParentMessage) => {
        const handleDefault = () => {
          const appletToParentMessage: AppletToParentMessage = {
            request: request.request,
            source: {
              type: 'applet',
              appletHash: this.appletHash!,
              groupHash: this.groupHash!,
              subType: request.source.subType,
            },
          };
          // console.log('Sending AppletToParentMessage: ', appletToParentMessage);
          return walWindow.electronAPI.appletMessageToParent(appletToParentMessage);
        };
        if (request) {
          switch (request.request.type) {
            case 'sign-zome-call':
              return window.electronAPI.signZomeCallApplet(request.request.request);
            case 'user-select-screen':
              return window.electronAPI.selectScreenOrWindow();
            case 'request-close':
              return walWindow.electronAPI.closeWindow();
            case 'user-select-asset': {
              await walWindow.electronAPI.focusMainWindow();
              let error;
              let response;
              const appletToParentMessage: AppletToParentMessage = {
                request: message.data.request,
                source: {
                  type: 'applet',
                  appletHash: this.appletHash!,
                  groupHash: this.groupHash!,
                  subType: request.source.subType,
                },
              };
              try {
                response = await walWindow.electronAPI.appletMessageToParent(appletToParentMessage);
              } catch (e) {
                error = e;
              }
              await walWindow.electronAPI.focusMyWindow();
              if (error) return Promise.reject(`Failed to select WAL: ${error}`);
              return response;
            }
            case 'user-select-asset-relation-tag': {
              await walWindow.electronAPI.focusMainWindow();
              let error;
              let response;
              const appletToParentMessage: AppletToParentMessage = {
                request: message.data.request,
                source: {
                  type: 'applet',
                  appletHash: this.appletHash!,
                  groupHash: this.groupHash!,
                  subType: request.source.subType,
                },
              };
              try {
                response = await walWindow.electronAPI.appletMessageToParent(appletToParentMessage);
              } catch (e) {
                error = e;
              }
              await walWindow.electronAPI.focusMyWindow();
              if (error) return Promise.reject(`Failed to select asset relation tag: ${error}`);
              return response;
            }
            case 'get-iframe-config': {
              if (this.isAppletDev === undefined) return;
              const iframeKind = getIframeKind(message, this.isAppletDev);
              if (!iframeKind) return;
              if (iframeKind.type === 'cross-group') {
                this.iframeStore.registerCrossGroupIframe(
                  iframeKind.toolCompatibilityId,
                  {
                    id: request.request.id,
                    subType: request.request.subType,
                    source: message.source,
                  }
                );
              } else {
                const appletId = encodeHashToBase64(iframeKind.appletHash);
                this.iframeStore.registerAppletIframe(
                  appletId,
                  {id: request.request.id,
                  subType: request.request.subType,
                  source: message.source,}
                );
              }
              return handleDefault();
            }
            case 'unregister-iframe': {
              if (this.isAppletDev === undefined) return;
              const iframeKind = getIframeKind(message, this.isAppletDev);
              if (!iframeKind) return;
              if (iframeKind.type === 'cross-group') {
                this.iframeStore.unregisterCrossGroupIframe(
                  iframeKind.toolCompatibilityId,
                  request.request.id,
                );
              } else {
                const appletId = encodeHashToBase64(iframeKind.appletHash);
                this.iframeStore.unregisterAppletIframe(appletId, request.request.id);
              }
              return handleDefault();
            }

            default:
              return handleDefault();
          }
        }
      };
      try {
        const result = await handleRequest(request);
        message.ports[0].postMessage({ type: 'success', result });
      } catch (e) {
        console.error(
          'Error while handling applet iframe message. Error: ',
          e,
          'Message: ',
          message,
        );
        message.ports[0].postMessage({ type: 'error', error: (e as any).message });
      }
    });

    this.isAppletDev = await walWindow.electronAPI.isAppletDev();
    const appletSrcInfo = await walWindow.electronAPI.getMySrc();
    if (!appletSrcInfo) throw new Error('No associated applet info found.');
    this.iframeSrc = appletSrcInfo.iframeSrc;
    this.appletHash = decodeHashFromBase64(appletSrcInfo.appletId);
    this.groupHash = decodeHashFromBase64(appletSrcInfo.groupId);
    try {
      const appletInfo: AppletInfo = await walWindow.electronAPI.appletMessageToParent({
        request: {
          type: 'get-applet-info',
          appletHash: this.appletHash,
        },
        source: {
          type: 'applet',
          appletHash: this.appletHash!,
          groupHash: this.groupHash!,
          subType: 'wal-window',
        },
      });
      let assetLocationAndInfo: AssetLocationAndInfo | undefined;
      console.log('Getting global asset info for WAL: ', appletSrcInfo.wal);
      try {
        assetLocationAndInfo = await walWindow.electronAPI.appletMessageToParent({
          request: {
            type: 'get-global-asset-info',
            wal: appletSrcInfo.wal,
          },
          source: {
            type: 'applet',
            appletHash: this.appletHash!,
            groupHash: this.groupHash!,
            subType: 'wal-window',
          },
        });
      } catch (e) {
        console.warn('Failed to get asset info: ', e);
      }

      let groupProfile: GroupProfile | undefined;
      if (appletInfo.groupsHashes.length > 0) {
        const groupDnaHash = appletInfo.groupsHashes[0];
        try {
          groupProfile = await walWindow.electronAPI.appletMessageToParent({
            request: {
              type: 'get-group-profile',
              groupHash: groupDnaHash,
            },
            source: {
              type: 'applet',
              appletHash: this.appletHash!,
              groupHash: this.groupHash!,
              subType: 'wal-window',
            },
          });
        } catch (e) {
          console.warn('Failed to get group profile: ', e);
        }
      }

      const title = `${appletInfo.appletName}${groupProfile ? ` (${groupProfile.name})` : ''} - ${assetLocationAndInfo ? `${assetLocationAndInfo.assetInfo.name}` : 'unknown'}`;

      await walWindow.electronAPI.setMyTitle(title);
      await walWindow.electronAPI.setMyIcon(appletInfo.appletIcon);
    } catch (e) {
      console.warn('Failed to set window title or icon: ', e);
    }
  }

  hardRefresh() {
    this.slowLoading = false;
    window.removeEventListener('beforeunload', this.beforeUnloadListener);
    // The logic to set this variable lives in walwindow.html
    if (window.__WINDOW_CLOSING__) {
      walWindow.electronAPI.closeWindow();
    } else {
      window.location.reload();
    }
  }

  renderLoading() {
    return html`
      <div
        class="column center-content"
        style="flex: 1; padding: 0; margin: 0; ${this.loading ? '' : 'display: none'}"
      >
        <img src="loading_animation.svg" />
        <div style="margin-top: 25px; margin-left: 10px; font-size: 18px; color: #142510">
          ${this.loading}
        </div>
        ${this.slowLoading
          ? html`
              <div class="column items-center" style="margin-top: 50px; max-width: 600px;">
                <div>
                  One or more Tools take unusually long to unload. Do you want to force reload?
                </div>
                <div style="margin-top: 10px; margin-bottom: 20px;">
                  (<b>Warning:</b> Force reloading may interrupt the Tool from saving unsaved
                  content)
                </div>
                <button
                  class="moss-button"
                  @click=${() => this.hardRefresh()}
                  style="margin-top: 20px; width: 150px;"
                >
                  Force Reload
                </button>
              </div>
            `
          : html``}
      </div>
    `;
  }

  render() {
    if (!this.iframeSrc) return html`<div class="center-content">Loading...</div>`;
    return html`
      <iframe
        id="wal-iframe"
        frameborder="0"
        src="${this.iframeSrc}"
        style=${`flex: 1; display: ${this.loading ? 'none' : 'block'}; padding: 0; margin: 0; height: 100vh;`}
        allow="camera *; microphone *; clipboard-write *;"
        @load=${() => {
          this.loading = undefined;
        }}
      ></iframe>
      ${this.renderLoading()}
    `;
  }

  static get styles() {
    return [
      mossStyles,
      css`
        :host {
          flex: 1;
          display: flex;
          margin: 0;
          padding: 0;
          background: url(Moss-launch-background.png);
          font-family: 'Inter Variable', 'Aileron', 'Open Sans', 'Helvetica Neue', sans-serif;
        }
      `,
    ];
  }
}

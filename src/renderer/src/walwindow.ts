import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { weStyles } from './shared-styles';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import {
  AppletHash,
  AppletId,
  AppletInfo,
  AppletToParentMessage,
  AppletToParentRequest,
  AssetLocationAndInfo,
  GroupProfile,
  ParentToAppletMessage,
  WAL,
} from '@theweave/api';
import { CallZomeRequest, CallZomeRequestSigned, decodeHashFromBase64 } from '@holochain/client';
import { localized, msg } from '@lit/localize';
import { postMessageToAppletIframes } from './utils';

import '@shoelace-style/shoelace/dist/components/button/button.js';

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
            wal: WAL;
          }
        | undefined
      >;
      onWindowClosing: (callback: (e: Electron.IpcRendererEvent) => any) => void;
      onParentToAppletMessage: (
        callback: (e: Electron.IpcRendererEvent, payload: ParentToAppletMessagePayload) => any,
      ) => void;
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
  @state()
  iframeSrc: string | undefined;

  @state()
  appletHash: AppletHash | undefined;

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
    e.preventDefault();
    console.log('onbeforeunload event');
    this.loading = 'Saving...';
    // If it takes longer than 5 seconds to unload, offer to hard reload
    this.slowReloadTimeout = window.setTimeout(() => {
      this.slowLoading = true;
    }, 4500);
    await postMessageToAppletIframes({ type: 'all' }, { type: 'on-before-unload' });
    console.log('on-before-unload callbacks finished.');
    window.removeEventListener('beforeunload', this.beforeUnloadListener);
    // The logic to set this variable lives in walwindow.html
    if (window.__WINDOW_CLOSING__) {
      console.log('__WINDOW_CLOSING__ is true.');
      walWindow.electronAPI.closeWindow();
    } else {
      window.location.reload();
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
      console.log('got parent to applet message: ', message);
      console.log('got parent to applet forApplets: ', forApplets);
      await postMessageToAppletIframes({ type: 'some', ids: forApplets }, message);
    });

    // set up handler to handle iframe messages
    window.addEventListener('message', async (message) => {
      const request = message.data.request as AppletToParentRequest;

      const handleRequest = async (request: AppletToParentRequest) => {
        if (request) {
          switch (request.type) {
            case 'sign-zome-call':
              return window.electronAPI.signZomeCallApplet(request.request);
            case 'user-select-screen':
              return window.electronAPI.selectScreenOrWindow();
            case 'request-close':
              return walWindow.electronAPI.closeWindow();
            case 'user-select-asset': {
              await (window.electronAPI as any).focusMainWindow();
              let error;
              let response;
              const appletToParentMessage: AppletToParentMessage = {
                request: message.data.request,
                appletHash: this.appletHash,
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

            default:
              const appletToParentMessage: AppletToParentMessage = {
                request: message.data.request,
                appletHash: this.appletHash,
              };
              return walWindow.electronAPI.appletMessageToParent(appletToParentMessage);
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

    const appletSrcInfo = await walWindow.electronAPI.getMySrc();
    if (!appletSrcInfo) throw new Error('No associated applet info found.');
    this.iframeSrc = appletSrcInfo.iframeSrc;
    this.appletHash = decodeHashFromBase64(appletSrcInfo.appletId);
    try {
      const appletInfo: AppletInfo = await (window.electronAPI as any).appletMessageToParent({
        request: {
          type: 'get-applet-info',
          appletHash: this.appletHash,
        },
        appletHash: this.appletHash,
      });
      let assetLocationAndInfo: AssetLocationAndInfo | undefined;
      console.log('Getting global asset info for WAL: ', appletSrcInfo.wal);
      try {
        assetLocationAndInfo = await (window.electronAPI as any).appletMessageToParent({
          request: {
            type: 'get-global-asset-info',
            wal: appletSrcInfo.wal,
          },
          appletHash: this.appletHash,
        });
      } catch (e) {
        console.warn('Failed to get asset info: ', e);
      }

      let groupProfile: GroupProfile | undefined;
      if (appletInfo.groupsHashes.length > 0) {
        const groupDnaHash = appletInfo.groupsHashes[0];
        try {
          groupProfile = await (window.electronAPI as any).appletMessageToParent({
            request: {
              type: 'get-group-profile',
              groupHash: groupDnaHash,
            },
            appletHash: this.appletHash,
          });
        } catch (e) {
          console.warn('Failed to get group profile: ', e);
        }
      }

      const title = `${appletInfo.appletName}${groupProfile ? ` (${groupProfile.name})` : ''} - ${assetLocationAndInfo ? `${assetLocationAndInfo.assetInfo.name}` : 'unknown'}`;

      await (window.electronAPI as any).setMyTitle(title);
      await (window.electronAPI as any).setMyIcon(appletInfo.appletIcon);
    } catch (e) {
      console.warn('Failed to set window title or icon: ', e);
    }
  }

  hardRefresh() {
    this.slowLoading = false;
    window.removeEventListener('beforeunload', this.beforeUnloadListener);
    // The logic to set this variable lives in walwindow.html
    if (window.__WINDOW_CLOSING__) {
      (window as any).electronAPI.closeWindow();
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
        <img src="moss-icon.svg" style="height: 80px; width: 80px;" />
        <div style="margin-top: 25px; margin-left: 10px; font-size: 24px; color: #142510">
          ${this.loading}
        </div>
        ${this.slowLoading
          ? html`
              <div
                class="column items-center"
                style="margin-top: 50px; max-width: 600px;color: white;"
              >
                <div>This Tool takes unusually long to reload. Do you want to force reload?</div>
                <div style="margin-top: 10px;">
                  (force reloading may interrupt the Tool from saving unsaved content)
                </div>
                <sl-button
                  variant="danger"
                  @click=${() => this.hardRefresh()}
                  style="margin-top: 20px; width: 150px;"
                  >Force Reload</sl-button
                >
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
      weStyles,
      css`
        :host {
          flex: 1;
          display: flex;
          margin: 0;
          padding: 0;
          background-color: #588121;
          font-family: 'Aileron', 'Open Sans', 'Helvetica Neue', sans-serif;
        }
      `,
    ];
  }
}

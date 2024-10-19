import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { weStyles } from './shared-styles';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import {
  AppletHash,
  AppletInfo,
  AppletToParentMessage,
  AppletToParentRequest,
  AssetLocationAndInfo,
  GroupProfile,
} from '@theweave/api';
import { decodeHashFromBase64 } from '@holochain/client';
import { localized, msg } from '@lit/localize';
import { postMessageToAppletIframes } from './utils';

import '@shoelace-style/shoelace/dist/components/button/button.js';

// import { ipcRenderer } from 'electron';

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
    }, 5000);
    await postMessageToAppletIframes({ type: 'all' }, { type: 'on-before-unload' });
    console.log('on-before-unload callbacks finished.');
    window.removeEventListener('beforeunload', this.beforeUnloadListener);
    // The logic to set this variable lives in walwindow.html
    if ((window as any).__WINDOW_CLOSING__) {
      (window as any).electronAPI.closeWindow();
    } else {
      window.location.reload();
    }
  };

  async firstUpdated() {
    window.addEventListener('beforeunload', this.beforeUnloadListener);

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
              window.removeEventListener('beforeunload', this.beforeUnloadListener);
              return (window.electronAPI as any).closeWindow();
            case 'user-select-wal': {
              await (window.electronAPI as any).focusMainWindow();
              let error;
              let response;
              const appletToParentMessage: AppletToParentMessage = {
                request: message.data.request,
                appletHash: this.appletHash,
              };
              try {
                response = await (window.electronAPI as any).appletMessageToParent(
                  appletToParentMessage,
                );
              } catch (e) {
                error = e;
              }
              await (window.electronAPI as any).focusMyWindow();
              if (error) return Promise.reject(`Failed to select WAL: ${error}`);
              return response;
            }

            default:
              const appletToParentMessage: AppletToParentMessage = {
                request: message.data.request,
                appletHash: this.appletHash,
              };
              return (window.electronAPI as any).appletMessageToParent(appletToParentMessage);
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

    const appletSrcInfo = await (window as any).electronAPI.getMySrc();
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
    if ((window as any).__WINDOW_CLOSING__) {
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

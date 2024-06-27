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
} from '@lightningrodlabs/we-applet';
import { decodeHashFromBase64 } from '@holochain/client';
// import { ipcRenderer } from 'electron';

@customElement('wal-window')
export class WalWindow extends LitElement {
  @state()
  iframeSrc: string | undefined;

  @state()
  appletHash: AppletHash | undefined;

  async firstUpdated() {
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

  render() {
    if (!this.iframeSrc) return html`<div class="center-content">Loading...</div>`;
    return html`
      <iframe
        frameborder="0"
        src="${this.iframeSrc}"
        style="flex: 1; display: block; padding: 0; margin: 0; height: 100vh;"
        allow="camera *; microphone *; clipboard-write *;"
      ></iframe>
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
        }
      `,
    ];
  }
}

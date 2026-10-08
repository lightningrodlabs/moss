import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { mossStyles } from './shared-styles';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import {
  AppletHash,
  AppletId,
  AppletInfo,
  AppletToParentMessage,
  AppletToParentRequest,
  AssetLocationAndInfo,
  GroupProfile,
  IframeKind,
  ParentToAppletMessage,
  WAL,
} from '@theweave/api';
import {
  CallZomeRequest,
  CallZomeRequestSigned,
  decodeHashFromBase64,
  DnaHash,
  DnaHashB64,
  encodeHashToBase64,
} from '@holochain/client';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import { IframeStore } from './iframe-store';
import { AppletChannel, UNLOAD_TIMEOUT_MS } from './applets/applet-channel/applet-channel';
import { deriveWalMessageSource, walZomeCallSigning } from './wal-message-source';
import { audioSourceGrantsClient, releaseGrantsFor } from './audio-sources/singletons.js';
import { TransferableReply } from './transferable-reply.js';

// import { ipcRenderer } from 'electron';

type ParentToAppletMessagePayload = {
  message: ParentToAppletMessage;
  forApplets: 'all' | AppletId[];
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
            groupId: DnaHashB64;
            wal: WAL;
          }
        | undefined
      >;
      isAppletDev: () => Promise<boolean>;
      onWindowClosing: (callback: (e: Electron.IpcRendererEvent) => any) => void;
      onParentToAppletMessage: (
        callback: (e: Electron.IpcRendererEvent, payload: ParentToAppletMessagePayload) => any,
      ) => void;
      onRequestIframeStoreSync: (callback: (e: Electron.IpcRendererEvent) => any) => void;
      iframeStoreSync: (storeContent) => void;
      selectScreenOrWindow: () => Promise<string>;
      setMyIcon: (icon: string) => Promise<void>;
      setMyTitle: (title: string) => Promise<void>;
      signZomeCallApplet: (
        request: CallZomeRequest,
        callerAppletIds: string[],
      ) => Promise<CallZomeRequestSigned>;
    };
  }
}

const walWindow = window as unknown as WALWindow;

/**
 * Relays a request that the person answers in the main window: brings the main
 * window forward for the choice, then returns focus to this WAL window.
 */
async function relayWithMainWindowFocus(
  request: AppletToParentRequest,
  source: IframeKind,
  failureLabel: string,
): Promise<unknown> {
  await walWindow.electronAPI.focusMainWindow();
  try {
    return await walWindow.electronAPI.appletMessageToParent({ request, source });
  } catch (e) {
    throw new Error(`${failureLabel}: ${e}`);
  } finally {
    await walWindow.electronAPI.focusMyWindow();
  }
}

@localized()
@customElement('wal-window')
export class WalWindow extends LitElement {
  iframeStore = new IframeStore();

  appletChannel = new AppletChannel({
    registry: this.iframeStore,
    isAppletDev: () => this.isAppletDev,
    ownWindow: window,
  });

  isAppletDev: boolean | undefined;

  @state()
  iframeSrc: string | undefined;

  @state()
  appletHash: AppletHash | undefined;

  @state()
  groupHash: DnaHash | undefined;

  @state()
  appletName: string | undefined;

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

  // Asks the ready applet frames to run their unload callbacks. It sends the
  // request before returning, ahead of each frame's own beforeunload, in which
  // the frame unregisters. The unload itself is not held: Chromium honors a
  // cancelled unload only after a user gesture on the page.
  beforeUnloadListener = () => {
    void this.appletChannel.requestAll('all', { type: 'on-before-unload' }, UNLOAD_TIMEOUT_MS);
  };

  async firstUpdated() {
    window.addEventListener('beforeunload', this.beforeUnloadListener);

    walWindow.electronAPI.onParentToAppletMessage(async (_e, { message, forApplets }) => {
      this.appletChannel.broadcast(forApplets, message);
    });

    walWindow.electronAPI.onRequestIframeStoreSync(async () => {
      const storeContent = [this.iframeStore.appletIframes, this.iframeStore.crossGroupIframes];
      await walWindow.electronAPI.iframeStoreSync(storeContent);
    });

    // Requests from the frames this window hosts. Requests that need the main
    // window's stores are relayed there under the frame's own identity.
    this.appletChannel.listen(window, async (request, { kind: iframeKind, source }) => {
      const derivedSource = deriveWalMessageSource(iframeKind, iframeKind.subType, this.groupHash!);

      const handleDefault = () => {
        return walWindow.electronAPI.appletMessageToParent({
          request,
          source: derivedSource,
        });
      };
      switch (request.type) {
        case 'sign-zome-call': {
          const signing = walZomeCallSigning(iframeKind);
          if (signing.route === 'relay') return handleDefault();
          return window.electronAPI.signZomeCallApplet(request.request, signing.callerAppletIds);
        }
        case 'user-select-screen':
          return window.electronAPI.selectScreenOrWindow();
        // Must resolve locally, never `handleDefault()`: the reply carries a
        // transferred `MessagePort` (see the TransferableReply below), and a
        // transferred port cannot cross the IPC hop to the main window.
        case 'request-audio-sources': {
          const iframeKey = this.iframeStore.findIframeIdBySource(source);
          const toolName =
            iframeKind.type === 'applet'
              ? (this.appletName ?? encodeHashToBase64(iframeKind.appletHash))
              : iframeKind.toolCompatibilityId;
          const grant = await audioSourceGrantsClient.request({ iframeKey, toolName });
          if (!grant) return null;
          return new TransferableReply(
            { label: grant.result.label, canExcludeSelf: grant.result.canExcludeSelf },
            [grant.port],
          );
        }
        case 'request-close':
          return walWindow.electronAPI.closeWindow();
        case 'user-select-asset':
          return relayWithMainWindowFocus(request, derivedSource, 'Failed to select WAL');
        case 'user-select-asset-relation-tag':
          return relayWithMainWindowFocus(
            request,
            derivedSource,
            'Failed to select asset relation tag',
          );
        case 'get-iframe-config': {
          if (iframeKind.type === 'cross-group') {
            this.iframeStore.registerCrossGroupIframe(iframeKind.toolCompatibilityId, {
              id: request.id,
              subType: request.subType,
              source: source,
            });
          } else {
            this.iframeStore.registerAppletIframe(encodeHashToBase64(iframeKind.appletHash), {
              id: request.id,
              subType: request.subType,
              source: source,
            });
          }
          // Forward under the child iframe's own identity, not this window's.
          return walWindow.electronAPI.appletMessageToParent({
            request,
            source: derivedSource,
          });
        }
        case 'unregister-iframe': {
          if (iframeKind.type === 'cross-group') {
            this.iframeStore.unregisterCrossGroupIframe(iframeKind.toolCompatibilityId, request.id);
          } else {
            this.iframeStore.unregisterAppletIframe(
              encodeHashToBase64(iframeKind.appletHash),
              request.id,
            );
          }
          releaseGrantsFor(request.id);
          return walWindow.electronAPI.appletMessageToParent({
            request,
            source: derivedSource,
          });
        }

        default:
          return handleDefault();
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
      this.appletName = appletInfo.appletName;
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

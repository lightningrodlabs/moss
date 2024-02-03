import { provide } from '@lit/context';
import { state, customElement } from 'lit/decorators.js';
import { AdminWebsocket, AppWebsocket } from '@holochain/client';
import { LitElement, html, css } from 'lit';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';

import './password/enter-password.js';
import './password/create-password.js';
import './password/factory-reset.js';
import './elements/main-dashboard.js';
import { weStyles } from './shared-styles.js';
import { weStoreContext } from './context.js';
import { WeStore } from './we-store.js';
import { getCellNetworkSeed, getProvisionedCells, initAppClient } from './utils.js';
import { AppletBundlesStore } from './applet-bundles/applet-bundles-store.js';
import { getConductorInfo, isAppletDev } from './electron-api.js';

type State = { state: 'loading' } | { state: 'running' } | { state: 'factoryReset' };

@customElement('we-app')
export class WeApp extends LitElement {
  @state()
  state: State = { state: 'loading' };

  @state()
  _appletUiUpdateCheckInterval: number | undefined;

  @state()
  _showFeedbackBoard = false;

  @state()
  _feedbackBoardReady = false;
  // @state()
  // previousState: State = { state: 'loading' };

  @provide({ context: weStoreContext })
  @state()
  _weStore!: WeStore;

  async firstUpdated() {
    // await listen('clear-systray-notification-state', async () => {
    //   await invoke('clear_systray_notification_state', {});
    // });
    // await listen('request-factory-reset', () => {
    //   console.log('Received factory reset event.');
    //   this.previousState = this.state;
    //   this.state = { state: 'factoryReset' };
    // });
    // const launched = await isLaunched();
    // if (launched) {
    window.__ZOME_CALL_LOGGING_ENABLED__ = true;
    try {
      await this.connect();
    } catch (e) {
      console.error(e);
    }

    window.addEventListener('message', async (message) => handleHappMessage(message));

    // Wait 20 seconds with showing the feedback button to give it time to load kando in the background
    if (!window.sessionStorage.getItem('feedbackTimeout')) {
      setTimeout(() => {
        window.sessionStorage.setItem('feedbackTimeout', 'true');
        this._feedbackBoardReady = true;
      }, 30000);
    } else {
      this._feedbackBoardReady = true;
    }

    await this._weStore.checkForUiUpdates();
    this._appletUiUpdateCheckInterval = window.setInterval(
      async () => await this._weStore.checkForUiUpdates(),
      20000,
    );
  }

  disconnectedCallback(): void {
    if (this._appletUiUpdateCheckInterval) {
      window.clearInterval(this._appletUiUpdateCheckInterval);
    }
    window.removeEventListener('message', handleHappMessage);
  }

  async connect() {
    this.state = { state: 'loading' };

    const info = await getConductorInfo();

    window['__HC_LAUNCHER_ENV__'] = {
      APP_INTERFACE_PORT: info.app_port,
      ADMIN_INTERFACE_PORT: info.admin_port,
      INSTALLED_APP_ID: '',
      FRAMEWORK: 'electron',
    };

    const adminWebsocket = await AdminWebsocket.connect(
      new URL(`ws://127.0.0.1:${info.admin_port}`),
    );

    const appWebsocket = await AppWebsocket.connect(new URL(`ws://127.0.0.1:${info.app_port}`));

    const appstore_app_id = info.appstore_app_id;

    const appStoreClient = await initAppClient(appstore_app_id);

    const isAppletDevMode = await isAppletDev();

    this._weStore = new WeStore(
      adminWebsocket,
      appWebsocket,
      info,
      new AppletBundlesStore(appStoreClient, adminWebsocket, info),
      isAppletDevMode,
    );

    const appStoreAppInfo = await appWebsocket.appInfo({
      installed_app_id: info.appstore_app_id,
    });
    // console.log("MY DEVHUB PUBLIC KEY: ", encodeHashToBase64(devhubAppInfo.agent_pub_key));

    getProvisionedCells(appStoreAppInfo).map(([_roleName, cellInfo]) =>
      console.log(`Appstore network seed: ${getCellNetworkSeed(cellInfo)}`),
    );

    const allApps = await adminWebsocket.listApps({});
    console.log('ALL INSTALLED APPS: ', allApps);

    this.state = { state: 'running' };

    // try {
    // console.log('Fetching available UI updates');
    //   await this._weStore.fetchAvailableUiUpdates();
    // } catch (e) {
    //   console.error('Failed to fetch available applet updates: ', e);
    // }
  }

  renderFeedbackBoard() {
    return html`
      <div
        class="feedback-board-container"
        style="${this._showFeedbackBoard ? '' : 'pointer-events: none;'}"
      >
        <div
          class="feedback-button ${this._feedbackBoardReady ? '' : 'loading'}"
          tabindex="0"
          @click=${() => {
            if (this._feedbackBoardReady) {
              this._showFeedbackBoard = !this._showFeedbackBoard;
            }
          }}
          @keypress=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              if (this._feedbackBoardReady) {
                this._showFeedbackBoard = !this._showFeedbackBoard;
              }
            }
          }}
        >
          ${this._showFeedbackBoard
            ? 'x close'
            : this._feedbackBoardReady
              ? 'Feedback'
              : 'loading...'}
        </div>
        <div class="feedback-top-bar" style="${this._showFeedbackBoard ? '' : 'display: none;'}">
          <span>Thank you for your feedback!</span>
          <span
            class="close-btn"
            tabindex="0"
            @click=${() => {
              this._showFeedbackBoard = !this._showFeedbackBoard;
            }}
            @keypress=${(e: KeyboardEvent) => {
              if (e.key === 'Enter') {
                () => {
                  this._showFeedbackBoard = !this._showFeedbackBoard;
                };
              }
            }}
            >x close</span
          >
        </div>
        <iframe
          frameborder="0"
          src="default-app://feedback-board"
          class="feedback-iframe"
          style="${this._showFeedbackBoard ? '' : 'display: none;'}"
        ></iframe>
      </div>
    `;
  }

  render() {
    switch (this.state.state) {
      case 'loading':
        return html`<div class="column center-content" style="flex: 1;">
          <sl-spinner style="font-size: 2rem"></sl-spinner>
        </div>`;
      case 'running':
        return html`
          ${this.renderFeedbackBoard()}
          <main-dashboard id="main-dashboard"></main-dashboard>
        `;
      case 'factoryReset':
        return html`
          <div class="column center-content" style="flex: 1">
            factory reset not implemented
            <!-- <factory-reset
              @cancel-factory-reset=${() => {
              // this.state = this.previousState;
            }}
            ></factory-reset> -->
          </div>
        `;
    }
  }

  static get styles() {
    return [
      weStyles,
      css`
        :host {
          flex: 1;
          display: flex;
        }
        .feedback-board-container {
          position: fixed;
          display: flex;
          height: 100vh;
          width: 100vw;
          margin: 0;
          z-index: 1;
        }

        .feedback-iframe {
          display: flex;
          flex: 1;
          box-sizing: border-box;
          border: 6px solid #27c60b;
        }

        .feedback-button {
          position: fixed;
          left: 0;
          bottom: 130px;
          padding: 20px 12px;
          min-height: 90px;
          justify-content: center;
          display: flex;
          color: white;
          font-weight: bold;
          font-size: 18px;
          writing-mode: vertical-rl;
          transform: rotate(-180deg);
          text-orientation: mixed;
          background: #27c60b;
          border-radius: 10px 0 0 10px;
          pointer-events: auto;
          cursor: pointer;
        }

        .feedback-button:hover:not(.loading) {
          background: #ecffe8;
          color: #27c60b;
        }

        .feedback-top-bar {
          position: fixed;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          color: white;
          top: 0;
          width: 100%;
          height: 57px;
          background: #27c60b;
        }

        .loading {
          opacity: 0.5;
          cursor: default;
        }

        .close-btn {
          position: absolute;
          right: 20px;
          cursor: pointer;
        }

        .close-btn:hover {
          color: black;
        }
      `,
    ];
  }
}

const handleHappMessage = async (message: MessageEvent<any>) => {
  if (!message.origin.startsWith('default-app://')) return null;
  if (message.data.type === 'sign-zome-call') {
    try {
      const signedZomeCall = await window.electronAPI.signZomeCall(message.data.payload);
      message.ports[0].postMessage({ type: 'success', result: signedZomeCall });
    } catch (e) {
      return Promise.reject(`Failed to sign zome call: ${e}`);
    }
  }
  return null;
};

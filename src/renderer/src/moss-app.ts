import { provide } from '@lit/context';
import { state, customElement } from 'lit/decorators.js';
import { AdminWebsocket } from '@holochain/client';
import { LitElement, html, css } from 'lit';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';

import './elements/main-dashboard.js';
import { weStyles } from './shared-styles.js';
import { mossStoreContext } from './context.js';
import { MossStore } from './moss-store.js';
import { appletDevConfig, getConductorInfo } from './electron-api.js';

type State = { state: 'loading' } | { state: 'running' };

@customElement('moss-app')
export class MossApp extends LitElement {
  @state()
  state: State = { state: 'loading' };

  @state()
  _appletUiUpdateCheckInterval: number | undefined;

  // @state()
  // previousState: State = { state: 'loading' };

  @provide({ context: mossStoreContext })
  @state()
  _mossStore!: MossStore;

  async firstUpdated() {
    window.window.__WEAVE_PROTOCOL_VERSION__ = '0.13';
    window.__ZOME_CALL_LOGGING_ENABLED__ = true;
    try {
      await this.connect();
    } catch (e) {
      console.error(e);
    }

    window.addEventListener('message', async (message) => handleHappMessage(message));

    await this._mossStore.checkForUiUpdates();
    // Check once every hour or on page refresh
    this._appletUiUpdateCheckInterval = window.setInterval(
      async () => await this._mossStore.checkForUiUpdates(),
      3_600_000,
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
    };

    const adminWebsocket = await AdminWebsocket.connect({
      url: new URL(`ws://127.0.0.1:${info.admin_port}`),
    });

    const devConfig = await appletDevConfig();

    this._mossStore = new MossStore(
      adminWebsocket,
      info,
      // new ToolsLibraryStore(
      //   new ToolsLibraryClient(toolsLibraryAppClient, 'tools', 'library'),
      //   info,
      // ),
      devConfig,
    );

    // Listen for general activity to set the latest activity timestamp
    document.addEventListener('mousemove', () => {
      this._mossStore.myLatestActivity = Date.now();
    });
    document.addEventListener('mousedown', () => {
      this._mossStore.myLatestActivity = Date.now();
    });
    document.addEventListener('keypress', () => {
      this._mossStore.myLatestActivity = Date.now();
    });
    document.addEventListener('touchmove', () => {
      this._mossStore.myLatestActivity = Date.now();
    });

    const allApps = await adminWebsocket.listApps({});
    console.log('ALL INSTALLED APPS: ', allApps);

    this.state = { state: 'running' };
  }

  render() {
    switch (this.state.state) {
      case 'loading':
        return html`<div class="column center-content" style="flex: 1;">
          <sl-spinner style="font-size: 2rem"></sl-spinner>
        </div>`;
      case 'running':
        return html` <main-dashboard id="main-dashboard"></main-dashboard> `;
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
      const signedZomeCall = await window.__HC_ZOME_CALL_SIGNER__.signZomeCall(
        message.data.payload,
      );
      message.ports[0].postMessage({ type: 'success', result: signedZomeCall });
    } catch (e) {
      return Promise.reject(`Failed to sign zome call: ${e}`);
    }
  }
  return null;
};

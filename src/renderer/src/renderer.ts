/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/application-architecture#main-and-renderer-processes
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.ts` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import { LitElement, css, html } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { sharedStyles } from './sharedStyles';
import { AppInfo } from '@holochain/client';

@customElement('admin-window')
export class AdminWindow extends LitElement {
  @state()
  installedApps: AppInfo[] = [];

  @state()
  installDisabled = true;

  @state()
  kandoInstallDisabled = true;

  @query('#select-app-input')
  selectAppInput!: HTMLInputElement;

  @query('#app-id-input-field')
  appIdInputField!: HTMLInputElement;

  @query('#network-seed-input-field')
  networkSeedInputField!: HTMLInputElement;

  @query('#kando-id-input-field')
  kandoIdInputField!: HTMLInputElement;

  @query('#kando-network-seed-input-field')
  kandoNetworkSeedInputField!: HTMLInputElement;

  checkInstallValidity() {
    if (!this.appIdInputField) {
      this.installDisabled = true;
      return;
    }
    console.log("VALUE === '': ", this.appIdInputField.value === '');
    this.installDisabled =
      !this.appIdInputField.value ||
      this.appIdInputField.value === '' ||
      this.installedApps.map((app) => app.installed_app_id).includes(this.appIdInputField.value);
    // return true;
    // return !!this.appIdInputField.value;
  }

  checkKandoInstallValidity() {
    if (!this.kandoIdInputField) {
      this.kandoInstallDisabled = true;
      return;
    }
    console.log("VALUE === '': ", this.appIdInputField.value === '');
    this.kandoInstallDisabled =
      !this.kandoIdInputField.value ||
      this.kandoIdInputField.value === '' ||
      this.installedApps.map((app) => app.installed_app_id).includes(this.kandoIdInputField.value);
    // return true;
    // return !!this.appIdInputField.value;
  }

  async installApp() {
    console.log('Installing app...');
    const file = this.selectAppInput.files![0];
    console.log('FILE PATH: ', (file as any).path);
    if (file) {
      await (window as any).electronAPI.installApp(
        (file as any).path,
        this.appIdInputField.value,
        this.networkSeedInputField.value,
      );
      this.installedApps = await (window as any).electronAPI.getInstalledApps();
      this.appIdInputField.value = '';
      this.networkSeedInputField.value = '';
      this.checkInstallValidity();
    } else {
      alert('No file selected.');
    }
  }

  async installKando() {
    console.log('Installing KanDo...');

    await (window as any).electronAPI.installApp(
      '#####REQUESTED_KANDO_INSTALLATION#####',
      this.kandoIdInputField.value,
      this.networkSeedInputField.value,
    );
    this.installedApps = await (window as any).electronAPI.getInstalledApps();
    this.kandoIdInputField.value = '';
    this.kandoNetworkSeedInputField.value = '';
    this.checkInstallValidity();
  }

  async firstUpdated() {
    const installedApps = await (window as any).electronAPI.getInstalledApps();
    console.log('INSTALLED APPS: ', installedApps);
    this.installedApps = installedApps;
  }

  async openApp(appId: string) {
    await (window as any).electronAPI.openApp(appId);
  }

  async uninstallApp(appId: string) {
    console.log('Uninstalling app...');
    await (window as any).electronAPI.uninstallApp(appId);
    this.installedApps = await (window as any).electronAPI.getInstalledApps();
  }

  render() {
    return html`
      <div class="column center-content" style="flex: 1;">
        <h1>Electron Launcher Prototype</h1>
        <!-- <a href="https://duckduckgo.com" target="_blank">DuckDuckGo</a> -->
        <div class="row">
            <div class="column install-box">
              <h2>Install New App</h2>
              <div style="margin-bottom: 30px;">Install a Holochain app from the filesystem (.webhapp).</div>
              <div style="margin-top: 10px; margin-bottom: 3px; font-size: 15px;">Select App from filesystem:</div>
              <input type="file" accept=".webhapp" id="select-app-input" />
              <div style="margin-top: 10px; margin-bottom: 3px; font-size: 15px;">Choose a name for the app:</div>
              <input
                type="text"
                placeholder="Custom App Name"
                id="app-id-input-field"
                @input=${this.checkInstallValidity}
              />
              <div style="margin-top: 10px; margin-bottom: 3px; font-size: 15px;">Choose a network seed (Optional):</div>
              <input
                type="text"
                placeholder="Network Seed (optional)"
                id="network-seed-input-field"
              />
              <button
                style="margin-top: 10px; height: 28px;"
                id="install-app-button"
                .disabled=${this.installDisabled}
                @click=${this.installApp}
              >
                Install app
              </button>
            </div>
            <div class="column install-box">
              <h2>Install KanDo</h2>
              <div style="margin-bottom: 30px;">KanDo is an app for collaborative KanBan boards and available by default as an example app.</div>
              <div style="margin-top: 10px; margin-bottom: 3px; font-size: 15px;">Choose a name for the KanDo instance<br>(You can install more than one instance of KanDo):</div>
              <input
                type="text"
                placeholder="Custom App Name"
                id="kando-id-input-field"
                @input=${this.checkKandoInstallValidity}
              />
              <div style="margin-top: 10px; margin-bottom: 3px; font-size: 15px;">Choose a network seed (Optional):</div>
              <input
                type="text"
                placeholder="Network Seed (optional)"
                id="kando-network-seed-input-field"
              />
              <button
                style="margin-top: 10px; height: 28px;"
                id="install-app-button"
                .disabled=${this.kandoInstallDisabled}
                @click=${this.installKando}
              >
                Install
              </button>
            </div>
          </div>
          <h2>Installed Apps</h2>
          ${this.installedApps.map((app) => {
            return html`
              <div class="row app-card">
                <div>${app.installed_app_id}</div>
                <span style="flex: 1;"></span>
                <button
                  style="margin-right: 10px;"
                  @click=${() => this.uninstallApp(app.installed_app_id)}
                >
                  UNINSTALL
                </button>
                <button @click=${() => this.openApp(app.installed_app_id)}>OPEN</button>
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  static get styles() {
    return [
      sharedStyles,
      css`
        :host {
          flex: 1;
          display: flex;
        }

        .app-card {
          font-size: 25px;
          padding: 0 30px;
          height: 100px;
          align-items: center;
          background: #e0e0e0;
          border-radius: 15px;
          width: 600px;
          margin-bottom: 10px;
        }

        .install-box {
          background: #e0edff;
          padding: 20px;
          border-radius: 15px;
          margin: 5px;
          width: 400px;
        }
      `,
    ];
  }
}

// const selectAppInput = document.getElementById("select-app-input") as HTMLInputElement;

// const installAppButton = document.getElementById("install-app-button");
// installAppButton.addEventListener("click", async () => {
//   const file = selectAppInput.files[0];
//   if (file){
//     await (window as any).electronAPI.installApp(file.path)
//   } else {
//     alert("No file selected.");
//   }
// });

// const uninstallAppButton = document.getElementById("uninstall-app-button");
// uninstallAppButton.addEventListener("click", async () => await (window as any).electronAPI.uninstallApp());

// const openAppButton = document.getElementById("open-app-button");
// openAppButton.addEventListener("click", async () => await (window as any).electronAPI.openApp());

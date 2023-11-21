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

@customElement("admin-window")
export class AdminWindow extends LitElement {

  @state()
  installedApps: AppInfo[] = [];

  @state()
  installDisabled = true;

  @query('#select-app-input')
  selectAppInput!: HTMLInputElement;

  @query('#app-id-input-field')
  appIdInputField!: HTMLInputElement;

  checkInstallValidity() {
    if (!this.appIdInputField) {
      this.installDisabled = true;
      return;
    }
    console.log("VALUE === '': ", this.appIdInputField.value === '');
    this.installDisabled = !this.appIdInputField.value
      || this.appIdInputField.value === ''
      || this.installedApps.map((app) => app.installed_app_id).includes(this.appIdInputField.value);
    // return true;
    // return !!this.appIdInputField.value;
  }

  async installApp() {
    console.log("Installing app...");
    const file = this.selectAppInput.files[0];
    if (file){
      await (window as any).electronAPI.installApp(file.path, this.appIdInputField.value);
      this.installedApps = await (window as any).electronAPI.getInstalledApps();
      this.appIdInputField.value = null;
      this.checkInstallValidity();
    } else {
      alert("No file selected.");
    }
  }

  async firstUpdated() {
    const installedApps = await (window as any).electronAPI.getInstalledApps();
    console.log("INSTALLED APPS: ", installedApps);
    this.installedApps = installedApps;
  }

  async openApp(appId: string) {
    await (window as any).electronAPI.openApp(appId)
  }

  async uninstallApp(appId: string) {
    console.log("Uninstalling app...");
    await (window as any).electronAPI.uninstallApp(appId);
    this.installedApps = await (window as any).electronAPI.getInstalledApps();
  }

  render() {
    return html`
      <div class="column center-content" style="flex: 1;">
        <h1>Electron Launcher Prototype</h1>
        <a href="https://duckduckgo.com" target="_blank">DuckDuckGo</a>
        <h2>Install New App</h2>
        <div class="column">
          <input type="file" accept=".webhapp" id="select-app-input" />
          <input type="text" placeholder="App Id" id="app-id-input-field" @input=${this.checkInstallValidity} />
          <button id="install-app-button" .disabled=${this.installDisabled} @click=${this.installApp}>Install app</button>
        </div>
        <h2>Installed Apps</h2>
        ${
          this.installedApps.map((app) => {
            return html`
              <div class="row app-card">
                <div>${app.installed_app_id}</div>
                <span style="flex: 1;"></span>
                <button style="margin-right: 10px;" @click=${() => this.uninstallApp(app.installed_app_id)}>UNINSTALL</button>
                <button @click=${() => this.openApp(app.installed_app_id)} >OPEN</button>
              </div>
            `
          })
        }
      </div>
    `
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



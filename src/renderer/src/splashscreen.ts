import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sharedStyles } from './sharedStyles';
// import { ipcRenderer } from 'electron';

@customElement('splash-screen')
export class SplashScreen extends LitElement {
  @state()
  progressState: string = '';

  firstUpdated() {
    (window as any).electronAPI.onProgressUpdate((e, payload) => {
      console.log('RECEIVED PROGRESS UPDATE: ', e, payload);
      this.progressState = payload;
    });
  }

  render() {
    return html`
      <div class="background">
        <div class="center-content loader">Starting...</div>
        <div class="bottom-left">${this.progressState}</div>
        <div class="bottom-right">Holochain Launcher (Electron Prototype)</div>
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
          margin: 0;
          padding: 0;
        }

        .loader {
          color: #e6e3fc;
          font-size: 35px;
        }

        .bottom-left {
          position: absolute;
          bottom: 5px;
          left: 5px;
          color: #e6e3fc;
          font-size: 15px;
        }

        .bottom-right {
          position: absolute;
          bottom: 5px;
          right: 5px;
          color: #e6e3fc;
          font-size: 15px;
        }

        .background {
          position: relative;
          display: flex;
          flex: 1;
          justify-content: center;
          align-items: center;
          height: 100vh;
          background-color: #331ead;
          background-size: cover;
          background-position: center center;
          background-image: url(/img/Holochain_Halo_complete_transparent.svg);
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

import { LitElement, css, html } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { weStyles } from './shared-styles';
// import { ipcRenderer } from 'electron';

enum SplashScreenMode {
  Loading,
  SetupLair,
  SetupLairConfirm,
  EnterPassword,
  Launching,
}

@customElement('splash-screen')
export class SplashScreen extends LitElement {
  @state()
  progressState: string = '';

  @state()
  passwordsDontMatch = false;

  @state()
  password: string | undefined;

  @state()
  launchError: string | undefined;

  @query('#password-input')
  passwordInput!: HTMLInputElement | undefined;

  @query('#confirm-password-input')
  confirmPasswordInput!: HTMLInputElement | undefined;

  @state()
  view: SplashScreenMode = SplashScreenMode.Loading;

  async firstUpdated() {
    (window as any).electronAPI.onProgressUpdate((e, payload) => {
      console.log('RECEIVED PROGRESS UPDATE: ', e, payload);
      this.progressState = payload;
    });
    const lairSetupRequired = await (window as any).electronAPI.lairSetupRequired();
    console.log('lairSetupRequired: ', lairSetupRequired);
    if (lairSetupRequired) {
      this.view = SplashScreenMode.SetupLair;
    } else {
      this.view = SplashScreenMode.EnterPassword;
    }
  }

  async setupAndLaunch() {
    const confirmPassword = this.confirmPasswordInput?.value;
    if (!confirmPassword || confirmPassword !== this.password) {
      this.passwordsDontMatch = true;
      return;
    }
    this.view = SplashScreenMode.Launching;
    try {
      await (window as any).electronAPI.launch(this.password);
    } catch (e) {
      console.error('Failed to launch: ', e);
      this.view = SplashScreenMode.SetupLair;
    }
  }

  async launch() {
    this.view = SplashScreenMode.Launching;
    try {
      await (window as any).electronAPI.launch(this.password);
    } catch (e: any) {
      console.error('Failed to launch: ', e);
      if (e.toString().includes('Wrong password.')) {
        this.password = undefined;
        this.launchError = 'Wrong password.';
        setTimeout(() => {
          this.launchError = undefined;
        }, 3000);
      } else {
        this.launchError = e;
        setTimeout(() => {
          this.launchError = undefined;
        }, 6000);
      }
      this.view = SplashScreenMode.EnterPassword;
    }
  }

  checkPasswords() {
    const confirmPassword = this.confirmPasswordInput?.value;
    if (!confirmPassword || confirmPassword !== this.password) {
      this.passwordsDontMatch = true;
    } else {
      this.passwordsDontMatch = false;
    }
  }

  setupDisabled() {
    return !this.password || this.password === '' || this.passwordsDontMatch;
  }

  renderSetupLair() {
    return html`
      <div class="column center-content">
        <h2>Setup We</h2>
        <div style="font-size: 17px; max-width: 500px; text-align: center;">
          Choose a password to encrypt your data and private keys. You will always need this
          password to start We.
        </div>
        <h3>Select Password:</h3>
        <input
          autofocus
          @input=${(_e: InputEvent) => {
            this.checkPasswords();
            this.password = this.passwordInput!.value;
          }}
          id="password-input"
          type="password"
        />
        <h3>Confirm Password:</h3>
        <input
          @input=${(_e: InputEvent) => this.checkPasswords()}
          id="confirm-password-input"
          type="password"
          @keypress=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              if (!this.setupDisabled()) {
                this.setupAndLaunch();
              }
            }
          }}
        />
        <div class="input-error ${this.passwordsDontMatch ? '' : 'color-transparent'}">
          Passwords don't match!
        </div>
        <button
          @click=${() => this.setupAndLaunch()}
          tabindex="0"
          style="margin-top: 10px; margin-bottom: 30px;"
          .disabled=${this.setupDisabled()}
        >
          Setup and Launch
        </button>
      </div>
    `;
  }

  renderEnterPassword() {
    return html`
      <div class="column center-content">
        <h3>Enter Password:</h3>
        <input
          autofocus
          @input=${(_e: InputEvent) => {
            this.password = this.passwordInput!.value;
          }}
          @keypress=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              this.launch();
            }
          }}
          id="password-input"
          type="password"
        />
        <button
          @click=${() => this.launch()}
          tabindex="0"
          style="margin-top: 30px; margin-bottom: 30px;"
          .disabled=${!this.password || this.password === ''}
        >
          Launch
        </button>
      </div>
    `;
  }

  renderContent() {
    switch (this.view) {
      case SplashScreenMode.Loading:
        return html`loading`;
      case SplashScreenMode.SetupLair:
        return this.renderSetupLair();
      case SplashScreenMode.EnterPassword:
        return this.renderEnterPassword();
      case SplashScreenMode.Launching:
        return this.renderLaunching();
      default:
        return html``;
    }
  }

  renderLaunching() {
    return html` <h1>Starting up...</h1> `;
  }

  render() {
    return html`
      <div class="background">
        ${this.renderContent()}
        <div class="bottom-left">${this.progressState}</div>
        <div class="bottom-right">Lightningrod Labs We</div>
        <div class="top-right errorbar row " style="${this.launchError ? '' : 'display: none;'}">
          ${this.launchError}
        </div>
      </div>
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
          color: #e6e3fc;
        }

        .errorbar {
          background: #990606;
          color: #e6e3fc;
          border-radius: 10px;
          font-weight: bold;
          align-items: center;
          justify-content: flex-end;
          padding: 18px;
          box-shadow: 0px 0px 3px 1px black;
          font-size: 17px;
        }

        .input-error {
          margin-top: 3px;
          color: red;
        }

        .color-transparent {
          color: transparent;
        }

        h3 {
          margin-bottom: 8px;
        }

        button {
          all: unset;
          cursor: pointer;
          background: #ffffff;
          color: #331ead;
          padding: 10px;
          border-radius: 10px;
          font-weight: bold;
        }

        button:disabled {
          opacity: 0.5;
        }

        button:hover {
          background: #c7bfff;
        }

        button:focus {
          outline: 2px solid orange;
        }

        input {
          height: 30px;
          width: 200px;
          font-size: 20px;
          border-radius: 8px;
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

        .top-right {
          position: absolute;
          top: 8px;
          right: 8px;
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

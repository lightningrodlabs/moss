import { LitElement, css, html } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { weStyles } from './shared-styles';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiClose, mdiCog, mdiLockOpenOutline, mdiLockOpenVariantOutline } from '@mdi/js';
import { SlDialog } from '@shoelace-style/shoelace';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import { msg } from '@lit/localize';
import { PasswordType } from '@theweave/moss-types';
// import { ipcRenderer } from 'electron';

enum SplashScreenMode {
  Loading,
  Setup,
  SetupPassword,
  SetupPasswordConfirm,
  EnterPassword,
  Launching,
}

@customElement('splash-screen')
export class SplashScreen extends LitElement {
  @state()
  progressState: string = '';

  @state()
  profile: string | undefined;

  @state()
  passwordsDontMatch = false;

  @state()
  password: string | undefined;

  @state()
  passwordConfirmed: string | undefined;

  @state()
  launchError: string | undefined;

  @query('#password-input')
  passwordInput!: HTMLInputElement | undefined;

  @query('#confirm-password-input')
  confirmPasswordInput!: HTMLInputElement | undefined;

  @query('#settings-dialog')
  settingsDialog!: SlDialog;

  @state()
  view: SplashScreenMode = SplashScreenMode.Loading;

  @state()
  version: string | undefined;

  async firstUpdated() {
    (window as any).electronAPI.onProgressUpdate((e, payload) => {
      console.log('RECEIVED PROGRESS UPDATE: ', e, payload);
      this.progressState = payload;
    });
    await this.chooseView();
  }

  async chooseView() {
    const [lairSetupRequired, randomPwExists] = await (
      window as any
    ).electronAPI.lairSetupRequired();
    this.profile = await (window as any).electronAPI.getProfile();
    this.version = await (window as any).electronAPI.getVersion();
    if (lairSetupRequired) {
      this.view = SplashScreenMode.Setup;
    } else if (!lairSetupRequired && !randomPwExists) {
      this.view = SplashScreenMode.EnterPassword;
    } else if (!lairSetupRequired && randomPwExists) {
      this.view = SplashScreenMode.Launching;
      await this.launch({ type: 'random' });
    } else {
      throw new Error('Invalid lair setup state.');
    }
  }

  handleGoBack() {
    switch (this.view) {
      case SplashScreenMode.SetupPassword: {
        this.view = SplashScreenMode.Setup;
        this.password = undefined;
        break;
      }
      case SplashScreenMode.SetupPasswordConfirm: {
        this.view = SplashScreenMode.SetupPassword;
        break;
      }
      default:
        return;
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
      await (window as any).electronAPI.launch({ type: 'user-provided', password: this.password });
    } catch (e) {
      console.error('Failed to launch: ', e);
      this.progressState = '';
      this.view = SplashScreenMode.Setup;
    }
  }

  async setupWithoutPassword() {
    this.view = SplashScreenMode.Launching;
    try {
      await (window as any).electronAPI.launch({ type: 'random' });
    } catch (e) {
      console.error('Failed to launch: ', e);
      this.progressState = '';
      this.view = SplashScreenMode.Setup;
    }
  }

  async launch(passwordType: PasswordType) {
    this.view = SplashScreenMode.Launching;
    try {
      await (window as any).electronAPI.launch(passwordType);
    } catch (e: any) {
      console.error('Failed to launch: ', e);
      this.progressState = '';
      if (e.toString().includes('Wrong password.')) {
        this.password = undefined;
        this.launchError = 'Wrong password.';
        setTimeout(() => {
          if (this.passwordInput) this.passwordInput!.focus();
        });
        setTimeout(() => {
          this.launchError = undefined;
        }, 3000);
      } else {
        this.launchError = e;
        setTimeout(() => {
          this.launchError = undefined;
        }, 6000);
      }
      await this.chooseView();
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

  renderSetup() {
    return html`
      <div class="column items-center" style="font-size: 16px;">
        <h1>Moss Setup</h1>
        <div style="max-width: 700px; text-align: center; line-height: 1.5;">
          ${msg('Choose whether you want to set up Moss with or without a password.')}
        </div>
        <div style="max-width: 500px; text-align: center; line-height: 1.5;">
          ${msg('The password will be used to encrypt your data locally on your device.')}
        </div>
        <div
          style="max-width: 500px; text-align: center; line-height: 1.5; font-weight: bold; margin-bottom: 20px;"
        >
          ${msg('A password cannot be added or removed later.')}
        </div>
        <button
          @click=${() => {
            this.view = SplashScreenMode.SetupPassword;
          }}
          tabindex="0"
          style="margin-top: 10px; margin-bottom: 6px;"
        >
          <div class="row items-center" style="font-size: 20px;">
            <sl-icon src="${wrapPathInSvg(mdiLockOpenOutline)}m" style="font-size: 24px;"></sl-icon>
            <div style="margin-left: 3px;">${msg('Setup With Password')}</div>
          </div>
        </button>
        <button
          @click=${() => this.setupWithoutPassword()}
          tabindex="0"
          style="margin-top: 10px; margin-bottom: 30px;"
        >
          <div class="row items-center" style="font-size: 20px;">
            <sl-icon
              src="${wrapPathInSvg(mdiLockOpenVariantOutline)}m"
              style="font-size: 24px;"
            ></sl-icon>
            <div style="margin-left: 3px;">${msg('Setup Without Password')}</div>
          </div>
        </button>
      </div>
    `;
  }

  renderSetupPassword() {
    return html`
      <div class="column center-content">
        <div class="row" style="align-items: center;">
          <h1>Choose Password</h1>
        </div>
        <div class="warning" style="font-size: 17px; max-width: 500px; text-align: center;">
          This password cannot be reset. Write it down or store it somewhere safe.
        </div>
        <h3>Password:</h3>
        <input
          autofocus
          @input=${(_e: InputEvent) => {
            this.password = this.passwordInput!.value;
          }}
          id="password-input"
          type="password"
        />
        <div class="row">
          <button
            @click=${() => {
              this.view = SplashScreenMode.SetupPasswordConfirm;
            }}
            tabindex="0"
            style="margin-top: 10px; margin-bottom: 30px;"
            .disabled=${!this.passwordInput || this.passwordInput!.value.length === 0}
          >
            ${'Next'}
          </button>
        </div>
      </div>
    `;
  }

  renderSetupPasswordConfirm() {
    return html`
      <div class="column center-content">
        <div class="row" style="align-items: center;">
          <h1>Confirm Password</h1>
        </div>
        <h3>Password:</h3>
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
              if (this.password) this.launch({ type: 'user-provided', password: this.password });
            }
          }}
          id="password-input"
          type="password"
        />
        <button
          @click=${() => {
            if (this.password) {
              this.launch({ type: 'user-provided', password: this.password });
            }
          }}
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
      case SplashScreenMode.Setup:
        return this.renderSetup();
      case SplashScreenMode.SetupPassword:
        return this.renderSetupPassword();
      case SplashScreenMode.SetupPasswordConfirm:
        return this.renderSetupPasswordConfirm();
      case SplashScreenMode.EnterPassword:
        return this.renderEnterPassword();
      case SplashScreenMode.Launching:
        return this.renderLaunching();
      default:
        return html``;
    }
  }

  renderLaunching() {
    return html` <h2>${this.progressState}</h2> `;
  }

  renderExitButton() {
    return html`
      <div class="top-right row" style="align-items: center;">
        <sl-icon
          tabindex="0"
          @click=${() => (window as any).electronAPI.exit()}
          @keypress=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              (window as any).electronAPI.exit();
            }
          }}
          title="Quit"
          class="exit-icon"
          .src=${wrapPathInSvg(mdiClose)}
        ></sl-icon>
      </div>
    `;
  }

  render() {
    return html`
      <sl-dialog style="color: black;" id="settings-dialog" label="${msg('Settings')}">
        <div class="column">
          <div><b>Factory Reset</b></div>
          <div
            class="row items-center"
            style="background: #ffaaaa; padding: 10px 5px; border-radius: 5px;"
          >
            <span style="margin-right: 20px;"
              >Fully reset Moss and <b>delete all associated data</b></span
            >
            <sl-button
              variant="danger"
              @click=${async () => await (window as any).electronAPI.factoryReset()}
              >Factory Reset</sl-button
            >
          </div>
        </div>
        <sl-button slot="footer" variant="primary" @click=${() => this.settingsDialog.hide()}
          >Close</sl-button
        >
      </sl-dialog>
      <div class="background">
        ${this.renderContent()}
        <span class="bottom-left"
          >v${this.version}${this.profile ? ` (profile: "${this.profile}")` : ''}</span
        >
        ${this.view === SplashScreenMode.Setup ||
        this.view === SplashScreenMode.Launching ||
        this.view === SplashScreenMode.EnterPassword
          ? html`<img
              class="top-left"
              src="icon.png"
              style="height: 60px; margin-right: 15px;"
              alt="Moss icon"
              title="Moss"
            />`
          : html`<button class="top-left" @click=${() => this.handleGoBack()}>
              < ${msg('Back')}
            </button>`}

        <sl-icon-button
          .src=${wrapPathInSvg(mdiCog)}
          ?disabled=${this.view === SplashScreenMode.Launching}
          class="top-right"
          style="font-size: 20px;"
          @click=${() => this.settingsDialog.show()}
        ></sl-icon-button>
        <div class="bottom-right">
          <div class="row" style="align-items: center;">
            <span style="color: white; margin-left: 6px;">Lightningrod Labs</span>
            <img src="lightningrodlabs_logo.png" style="height: 30px; margin-left: 6px" />
          </div>
        </div>
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
          color: white;
        }
        h2 {
          color: #ffffff;
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
          background: #9b7429;
          color: #ffffff;
          padding: 10px;
          border-radius: 10px;
          font-weight: bold;
        }

        button:disabled {
          opacity: 0.7;
        }

        button:hover:not(:disabled) {
          background: #b7962b;
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

        .exit-icon {
          font-size: 30px;
          color: white;
          cursor: pointer;
        }

        .loader {
          color: #e6e3fc;
          font-size: 35px;
        }

        .bottom-left {
          position: absolute;
          bottom: 3px;
          left: 5px;
          color: #ffffff;
          font-size: 15px;
        }

        .bottom-right {
          position: absolute;
          bottom: 5px;
          right: 10px;
          color: #ffffff;
          font-size: 15px;
        }

        .top-left {
          position: absolute;
          top: 5px;
          left: 10px;
          color: #ffffff;
        }

        .top-right {
          position: absolute;
          top: 5px;
          right: 5px;
          color: #ffffff;
        }

        .background {
          position: relative;
          display: flex;
          flex: 1;
          justify-content: center;
          align-items: center;
          height: 100vh;
        }

        .warning {
          padding: 20px;
          border-radius: 10px;
          background: #ffcc00;
          color: darkred;
          font-weight: bold;
        }
      `,
    ];
  }
}

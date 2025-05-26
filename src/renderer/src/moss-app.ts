import { provide } from '@lit/context';
import { state, customElement } from 'lit/decorators.js';
import { AdminWebsocket, DnaHash, ProvisionedCell } from '@holochain/client';
import { LitElement, html, css } from 'lit';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/radio-group/radio-group.js';
import '@shoelace-style/shoelace/dist/components/radio/radio.js';

import './elements/main-dashboard.js';
import { mossStyles } from './shared-styles.js';
import { mossStoreContext } from './context.js';
import { MossStore } from './moss-store.js';
import { appletDevConfig, getConductorInfo } from './electron-api.js';
import { localized, msg } from '@lit/localize';
import { arrowLeftShortIcon, mossIcon, plusCircleIcon } from './elements/_new_design/icons.js';
import './elements/_new_design/moss-select-avatar.js';
import './elements/_new_design/moss-select-avatar-fancy.js';
import { defaultIcons } from './elements/_new_design/defaultIcons.js';
// import { GroupProfile } from '@theweave/api';
import SlInput from '@shoelace-style/shoelace/dist/components/input/input.js';
import { partialModifiersFromInviteLink } from '@theweave/utils';
import { notifyError } from '@holochain-open-dev/elements';
import SlRadioGroup from '@shoelace-style/shoelace/dist/components/radio-group/radio-group.js';

enum MossAppState {
  Loading,
  InitialSetup,
  CreateGroupStep1,
  CreateGroupStep2,
  CreatingGroup,
  JoiningGroup,
  Error,
  Running,
}
@localized()
@customElement('moss-app')
export class MossApp extends LitElement {
  @state()
  state: MossAppState = MossAppState.Loading;

  @state()
  _appletUiUpdateCheckInterval: number | undefined;

  // @state()
  // previousState: State = { state: 'loading' };

  @provide({ context: mossStoreContext })
  @state()
  _mossStore!: MossStore;

  /**
   * The group to which the main-dashboard will switch to immediately
   * in the beginning. Used in case of the initial setup.
   */
  @state()
  initialGroup: DnaHash | undefined;

  @state()
  creatingGroup = false;

  @state()
  private inviteLink: string = '';

  /**
   * Used if group is created as part of initial setup
   */
  @state()
  private groupName = '';

  /**
   * Used if group is created as part of initial setup
   */
  @state()
  private groupIcon = '';

  /**
   * Used if group is created as part of initial setup
   */
  @state()
  private useProgenitor = true;

  // /**
  //  * Used if group is created as part of initial setup
  //  */
  // @state()
  // private nickname = '';

  // /**
  //  * Used if group is created as part of initial setup
  //  */
  // @state()
  // private avatar = '';

  @state()
  private loadingText = 'loading...';

  async firstUpdated() {
    this.loadingText = 'loading...';
    window.window.__WEAVE_PROTOCOL_VERSION__ = '0.14';
    window.__ZOME_CALL_LOGGING_ENABLED__ = !!window.sessionStorage.getItem(
      '__ZOME_CALL_LOGGING_ENABLED__',
    );
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
    this.state = MossAppState.Loading;
    let isFirstLaunch = await window.electronAPI.lairSetupRequired();
    if (isFirstLaunch) {
      // This is to ensure that a page reload on the initial setup
      // screen will stay on the initial setup screen or that reloading
      // Moss will remain on the first screen
      window.localStorage.setItem('isFirstLaunch', 'true');
    }

    let info = await getConductorInfo();
    // If the conductor is not running yet, start it
    // (it may for example already be running if the connect() function
    // is being run as part of a page reload)
    if (!info) {
      try {
        this.loadingText = 'starting Holochain...';
        await window.electronAPI.launch();
        info = await getConductorInfo();
        if (!info) throw new Error('Failed to get conductor info after launch.');
      } catch (e) {
        this.state = MossAppState.Error;
        return;
      }
    }

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

    isFirstLaunch = !!window.localStorage.getItem('isFirstLaunch');
    if (isFirstLaunch) {
      this.state = MossAppState.InitialSetup;
    }

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

    if (!isFirstLaunch) {
      this.state = MossAppState.Running;
    }
  }

  async createGroupAndHeadToMain(): Promise<void> {
    this.state = MossAppState.CreatingGroup;
    this.creatingGroup = true;
    const appInfo = await this._mossStore.createGroup(
      this.groupName,
      this.groupIcon,
      this.useProgenitor,
    );
    const groupDnaHash: DnaHash = (appInfo.cell_info['group'][0].value as ProvisionedCell)
      .cell_id[0];
    this.initialGroup = groupDnaHash;
    this.state = MossAppState.Running;
    this.creatingGroup = false;
    window.localStorage.removeItem('isFirstLaunch');
  }

  async joinGroupAndHeadToMain(): Promise<void> {
    this.creatingGroup = true;
    let modifiers;
    try {
      modifiers = partialModifiersFromInviteLink(this.inviteLink);
    } catch (e) {
      notifyError(`Invalid invite link: ${e}`);
      console.error('Error: Failed to join group: Invite link is invalid: ', e);
      this.creatingGroup = false;
      return;
    }

    if (!modifiers) {
      notifyError(msg('Modifiers undefined.'));
      console.error('Error: Failed to join group: Modifiers undefined.');
      this.creatingGroup = false;
      return;
    }

    this.state = MossAppState.JoiningGroup;

    try {
      const appInfo = await this._mossStore.joinGroup(modifiers.networkSeed, modifiers.progenitor);
      const groupDnaHash: DnaHash = (appInfo.cell_info['group'][0].value as ProvisionedCell)
        .cell_id[0];
      this.initialGroup = groupDnaHash;
      this.state = MossAppState.Running;
    } catch (e) {
      notifyError(msg('Failed to join the group.'));
      console.error(e);
      this.state = MossAppState.InitialSetup;
    }
    this.creatingGroup = false;
    window.localStorage.removeItem('isFirstLaunch');
  }

  renderCreateGroupStep1() {
    return html`
      <div class="column center-content flex-1 launch-bg">
        <div class="moss-card" style="width: 630px; height: 466px;">
          <button
            class="moss-hover-icon-button"
            style="margin-left: -8px; margin-top: -8px;"
            @click=${() => {
              this.state = MossAppState.InitialSetup;
            }}
          >
            <div class="row items-center">
              <div class="moss-hover-icon-button-icon" style="margin-right: 10px;">
                ${arrowLeftShortIcon(24)}
              </div>
              <div class="moss-hover-icon-button-text">${msg('back')}</div>
            </div>
          </button>
          <div class="column items-center">
            <span
              style="font-size: 28px; font-weight: 500; margin-bottom: 48px; margin-top: 30px; letter-spacing: -0.56px;"
              >${'My group is called'}</span
            >

            <sl-input
              id="group-name-input"
              class="moss-input"
              placeholder=${msg('group name')}
              label=${msg('group name')}
              size="medium"
              style="margin-bottom: 20px; width: 350px;"
              value=${this.groupName}
              required
              autofocus
              @input=${() => {
                const groupNameInput = this.shadowRoot?.getElementById(
                  'group-name-input',
                ) as SlInput;
                this.groupName = groupNameInput.value;
              }}
            >
            </sl-input>

            <moss-select-avatar-fancy
              style="margin-bottom: 56px;"
              .defaultImgs=${defaultIcons}
              label=""
              .required=${true}
              @avatar-selected=${(e) => {
                this.groupIcon = e.detail.avatar;
              }}
            ></moss-select-avatar-fancy>

            <button
              class="moss-button"
              style="width: 310px; margin-bottom: 56px;"
              ?disabled=${!this.groupIcon || !this.groupName || this.creatingGroup}
              @click=${() => {
                this.state = MossAppState.CreateGroupStep2;
              }}
            >
              ${this.creatingGroup
                ? html`<div class="column center-content">
                    <div class="dot-carousel" style="margin: 5px 0;"></div>
                  </div>`
                : html`${msg('Create group space')}`}
            </button>

            <div class="row">
              <div class="dialog-dot bg-black" style="margin-right: 20px;"></div>
              <div class="dialog-dot"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Renders the dialog to select whether group is stewarded or not
   */
  renderCreateGroupStep2() {
    return html`
      <div class="column center-content flex-1 launch-bg">
        <div class="moss-card" style="width: 630px; height: 466px;">
          <button
            class="moss-hover-icon-button"
            style="margin-left: -8px; margin-top: -8px;"
            @click=${() => {
              this.state = MossAppState.CreateGroupStep1;
            }}
          >
            <div class="row items-center">
              <div class="moss-hover-icon-button-icon" style="margin-right: 10px;">
                ${arrowLeftShortIcon(24)}
              </div>
              <div class="moss-hover-icon-button-text">${msg('back')}</div>
            </div>
          </button>
          <div class="column items-center flex-1" style="height: calc(100% - 28px);">
            <span
              style="font-size: 28px; font-weight: 500; margin-bottom: 48px; margin-top: 30px; letter-spacing: -0.56px;"
              >${'Choose Group Type'}</span
            >

            <sl-radio-group
              id="group-type-radio"
              style="margin-left: 50px; max-width: 500px;"
              value="1"
            >
              <sl-radio style="margin-top: 5px;" value="1"
                ><b>${msg('Stewarded')} (default)</b><br /><span
                  style="opacity: 0.8; font-size: 0.9rem;"
                  >The group creator (you) is the initial Steward. Only Stewards can edit the group
                  profile, add and remove Tools and add additional Stewards.</span
                ></sl-radio
              >
              <sl-radio style="margin-top: 5px;" value="0"
                ><b>${msg('Unstewarded')}</b><br /><span style="opacity: 0.8; font-size: 0.9rem;"
                  >All members have full permissions.</span
                ></sl-radio
              >
            </sl-radio-group>

            <div class="flex flex-1"></div>

            <button
              class="moss-button"
              style="width: 310px; margin-bottom: 56px;"
              ?disabled=${!this.groupIcon || !this.groupName || this.creatingGroup}
              @click=${() => {
                const groupTypeRadio = this.shadowRoot?.getElementById(
                  'group-type-radio',
                ) as SlRadioGroup;
                this.useProgenitor = groupTypeRadio.value === '1' ? true : false;
                this.createGroupAndHeadToMain();
              }}
            >
              ${this.creatingGroup
                ? html`<div class="column center-content">
                    <div class="dot-carousel" style="margin: 5px 0;"></div>
                  </div>`
                : html`${msg('Create group space')}`}
            </button>

            <div class="row">
              <div class="dialog-dot" style="margin-right: 20px;"></div>
              <div class="dialog-dot bg-black"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // renderCreateGroupStep3() {
  //   return html`
  //     <div class="column center-content flex-1">
  //       <div class="moss-card" style="width: 630px; height: 466px;">
  //         <button
  //           class="moss-hover-icon-button"
  //           style="margin-left: -8px; margin-top: -8px;"
  //           @click=${() => {
  //             this.state = MossAppState.CreateGroupStep1;
  //           }}
  //         >
  //           <div class="row items-center">
  //             <div class="moss-hover-icon-button-icon" style="margin-right: 10px;">
  //               ${arrowLeftShortIcon(24)}
  //             </div>
  //             <div class="moss-hover-icon-button-text">${msg('back')}</div>
  //           </div>
  //         </button>
  //         <div class="column items-center">
  //           <span
  //             style="font-size: 28px; font-weight: 500; margin-bottom: 48px; margin-top: 30px; letter-spacing: -0.56px;"
  //             >${'My group will see me as'}</span
  //           >

  //           <sl-input
  //             id="nickname-input"
  //             class="moss-input"
  //             placeholder=${msg('name or nickname')}
  //             label=${msg('name or nickname')}
  //             size="medium"
  //             style="margin-bottom: 20px; width: 350px;"
  //             @input=${() => {
  //               const nickNameInput = this.shadowRoot?.getElementById('nickname-input') as SlInput;
  //               this.nickname = nickNameInput.value;
  //             }}
  //           >
  //           </sl-input>

  //           <moss-select-avatar
  //             label=""
  //             style="margin-bottom: 56px;"
  //             @avatar-selected=${(e) => {
  //               this.avatar = e.detail.avatar;
  //             }}
  //           ></moss-select-avatar>

  //           <button
  //             class="moss-button"
  //             style="width: 310px; margin-bottom: 56px;"
  //             ?disabled=${!this.avatar || !this.nickname}
  //           >
  //             Next
  //           </button>

  //           <div class="row">
  //             <div class="dialog-dot" style="margin-right: 20px;"></div>
  //             <div class="dialog-dot bg-black"></div>
  //           </div>
  //         </div>
  //       </div>
  //     </div>
  //   `;
  // }

  renderInstallingGroup(joining: boolean) {
    return html`
      <div class="column center-content flex-1 launch-bg">
        <div class="moss-card" style="width: 630px; height: 466px;">
          <div class="column items-center">
            <div class="card-title" style="margin-top: 30px;">
              ${joining ? 'Joining group' : 'Creating a new space'}
            </div>
            <div class="card-title medium-green" style="margin-bottom: 38px;">
              ${'in the beautiful p2p realm.'}
            </div>

            <img src="loading_animation.svg" />

            <div style="font-size: 18px; color: var(--moss-inactive-green); margin-top: 10px;">
              ${msg('may take up to 1-2 minutes')}
            </div>
            <!-- <div class="row">
            <div class="dialog-dot bg-black" style="margin-right: 20px;"></div>
            <div class="dialog-dot"></div>
          </div> -->
          </div>
        </div>
      </div>
    `;
  }

  renderInitialSetup() {
    return html`
      <div class="column center-content flex-1 launch-bg">
        <div class="column items-center" style="margin-bottom: 52px;">
          <div style="margin-bottom: 28px;">${mossIcon(58)}</div>
          <div class="dialog-title">${msg('Welcome to Moss.')}</div>
          <div class="dialog-title">${msg('What brought you here today?')}</div>
        </div>

        <div class="row">
          <div class="moss-card column items-center" style="margin: 6px; width: 430px;">
            <div class="dialog-title" style="width: 300px; margin-bottom: 28px; margin-top: 40px;">
              ${msg('I have an invite link to join a group')}
            </div>

            <div class="column center-content hint" style="margin-bottom: 12px;">
              <div style="margin-bottom: 3px;">${msg('An invite link looks like:')}</div>
              <div class="">https://theweave.social/wal?weave-0.13://invite...</div>
            </div>

            <div class="row items-center justify-center" style="margin-bottom: 28px;">
              <sl-input
                class="moss-input"
                id="invite-link-input"
                placeholder=${msg('paste invite link here')}
                label=${msg('invite link')}
                style="margin-right: 12px; width: 258px;"
                @input=${() => {
                  const inviteLinkInput = this.shadowRoot?.getElementById(
                    'invite-link-input',
                  ) as HTMLInputElement;
                  this.inviteLink = inviteLinkInput.value;
                }}
              ></sl-input>
              <button
                id="join-group-btn"
                class="moss-button"
                ?disabled=${this.inviteLink === '' || this.creatingGroup}
                @click=${() => this.joinGroupAndHeadToMain()}
                style="width: 40px;"
              >
                ${this.creatingGroup
                  ? html`<div class="column center-content">
                      <div class="dot-carousel" style="margin: 5px 0;"></div>
                    </div>`
                  : html`${msg('Join')}`}
              </button>
            </div>
          </div>

          <div class="moss-card column items-center" style="margin: 6px; width: 430px;">
            <div class="dialog-title" style="width: 300px; margin-top: 40px;">
              ${msg('I want to start a space for my group')}
            </div>
            <span class="flex flex-1"></span>
            <button
              class="moss-button"
              style="width: 310px; margin-bottom: 28px;"
              ?disabled=${this.creatingGroup}
              @click=${() => {
                this.state = MossAppState.CreateGroupStep1;
              }}
            >
              <div class="row center-content">
                ${plusCircleIcon(20)}
                <div style="margin-left: 10px;">${msg('Create new group space')}</div>
              </div>
            </button>
          </div>
        </div>

        <button
          @click=${() => {
            window.localStorage.removeItem('isFirstLaunch');
            this.state = MossAppState.Running;
          }}
          class="skip-button"
          style="position: absolute; bottom: 10px;"
        >
          ${'Skip Setup'}
        </button>
      </div>
    `;
  }

  renderErrorPage() {
    return html`
      <div class="column center-content launch-bg" style="flex: 1;">
        <div class="dialog-title" style="margin-bottom: 30px;">
          ${msg('Holochain failed to start up and crashed :(')}
        </div>
        <div style="max-width: 600px; text-align: center; margin-bottom: 40px;">
          <span
            >${msg(
              'If you want to support us in finding the problem, please export the logs and send them to ',
            )}</span
          >
          <a href="mailto:moss.0.14.feedback@theweave.social">moss.0.14.feedback@theweave.social</a>
        </div>
        <div class="row items-center">
          <button
            class="moss-button"
            style="margin: 0 4px;"
            @click=${() => window.electronAPI.openLogs()}
          >
            ${msg('Open Logs')}
          </button>
          <button
            class="moss-button"
            style="margin: 0 4px;"
            @click=${() => window.electronAPI.exportLogs()}
          >
            ${msg('Export Logs')}
          </button>
          <button
            class="moss-button"
            style="margin: 0 4px;"
            @click=${() => window.location.reload()}
          >
            ${msg('Retry')}
          </button>
        </div>
      </div>
    `;
  }

  render() {
    switch (this.state) {
      case MossAppState.Loading:
        return html`<div class="column center-content launch-bg" style="flex: 1;">
          <img src="loading_animation.svg" />
          <div>${this.loadingText}</div>
        </div>`;
      case MossAppState.InitialSetup:
        return this.renderInitialSetup();
      case MossAppState.CreateGroupStep1:
        return this.renderCreateGroupStep1();
      case MossAppState.CreateGroupStep2:
        return this.renderCreateGroupStep2();
      case MossAppState.CreatingGroup:
        return this.renderInstallingGroup(false);
      case MossAppState.JoiningGroup:
        return this.renderInstallingGroup(true);
      case MossAppState.Error:
        return this.renderErrorPage();
      case MossAppState.Running:
        return html`
          <main-dashboard
            class="main-bg"
            id="main-dashboard"
            .initialGroup=${this.initialGroup}
          ></main-dashboard>
        `;
      default:
        return html`Unknown state`;
    }
  }

  static get styles() {
    return [
      mossStyles,
      css`
        :host {
          flex: 1;
          display: flex;
        }

        .hint {
          font-size: 12px;
          color: var(--moss-hint-green);
          border-radius: 12px;
          background-color: var(--moss-light-green);
          padding: 10px 20px;
          width: 310px;
          font-weight: 500;
        }

        .launch-bg {
          background: url(Moss-launch-background.png);
          background-size: cover;
        }

        .main-bg {
          background: linear-gradient(180deg, #1c251e 0%, #2c3a1c 69.5%, #4c461b 95%);
        }

        .loading {
          opacity: 0.5;
          cursor: default;
        }

        .card-title {
          font-size: 28px;
          font-weight: 500;
          letter-spacing: -0.56px;
        }

        .medium-green {
          color: var(--moss-medium-green);
        }

        .close-btn {
          position: absolute;
          right: 20px;
          cursor: pointer;
        }

        .close-btn:hover {
          color: black;
        }

        .skip-button {
          all: unset;
          font-size: 14px;
          text-decoration: underline;
          color: gray;
          border-radius: 3px;
          cursor: pointer;
        }

        .skip-button:focus-visible {
          outline: 1px solid orange;
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

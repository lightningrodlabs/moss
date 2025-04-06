import { provide } from '@lit/context';
import { state, customElement } from 'lit/decorators.js';
import { AdminWebsocket, CellType, DnaHash } from '@holochain/client';
import { LitElement, html, css } from 'lit';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';

import './elements/main-dashboard.js';
import { weStyles } from './shared-styles.js';
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

enum MossAppState {
  Loading,
  InitialSetup,
  CreateGroupStep1,
  CreateGroupStep2,
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

  async firstUpdated() {
    window.window.__WEAVE_PROTOCOL_VERSION__ = '0.13';
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
    isFirstLaunch = !!window.localStorage.getItem('isFirstLaunch');
    if (isFirstLaunch) {
      this.state = MossAppState.InitialSetup;
    }
    let info = await getConductorInfo();
    // If the conductor is not running yet, start it
    // (it may for example already be running if the connect() function
    // is being run as part of a page reload)
    if (!info) {
      try {
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
    this.creatingGroup = true;
    const appInfo = await this._mossStore.createGroup(
      this.groupName,
      this.groupIcon,
      this.useProgenitor,
    );
    const groupDnaHash: DnaHash = appInfo.cell_info['group'][0][CellType.Provisioned].cell_id[0];
    this.initialGroup = groupDnaHash;
    this.state = MossAppState.Running;
    this.creatingGroup = false;
    window.localStorage.removeItem('isFirstLaunch');
  }

  async joinGroupAndHeadToMain(): Promise<void> {
    let modifiers;
    try {
      modifiers = partialModifiersFromInviteLink(this.inviteLink);
    } catch (e) {
      notifyError(`Invalid invite link: ${e}`);
      console.error('Error: Failed to join group: Invite link is invalid: ', e);
      return;
    }

    if (!modifiers) {
      notifyError(msg('Modifiers undefined.'));
      console.error('Error: Failed to join group: Modifiers undefined.');
      return;
    }

    this.creatingGroup = true;

    try {
      const appInfo = await this._mossStore.joinGroup(modifiers.networkSeed, modifiers.progenitor);
      const groupDnaHash: DnaHash = appInfo.cell_info['group'][0][CellType.Provisioned].cell_id[0];
      this.initialGroup = groupDnaHash;
      this.state = MossAppState.Running;
    } catch (e) {
      notifyError(msg('Failed to join the group.'));
      console.error(e);
    }
    this.creatingGroup = false;
    window.localStorage.removeItem('isFirstLaunch');
  }

  renderCreateGroupStep1() {
    return html`
      <div class="column center-content flex-1">
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
              @click=${() => this.createGroupAndHeadToMain()}
            >
              ${this.creatingGroup
                ? html`<div class="column center-content">
                    <div class="dot-carousel" style="margin: 5px 0;"></div>
                  </div>`
                : html`${msg('Create new group')}`}
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

  // renderCreateGroupStep2() {
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

  renderInitialSetup() {
    return html`
      <div class="column center-content flex-1">
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
            >
              <div class="row center-content">
                ${plusCircleIcon(20)}
                <div
                  style="margin-left: 10px;"
                  @click=${() => {
                    console.log('Clicked.');
                    this.state = MossAppState.CreateGroupStep1;
                  }}
                >
                  ${msg('Create new group space')}
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    switch (this.state) {
      case MossAppState.Loading:
        return html`<div class="column center-content" style="flex: 1;">
          <sl-spinner style="font-size: 2rem"></sl-spinner>
        </div>`;
      case MossAppState.InitialSetup:
        return this.renderInitialSetup();
      case MossAppState.CreateGroupStep1:
        return this.renderCreateGroupStep1();
      // case MossAppState.CreateGroupStep2:
      //   return this.renderCreateGroupStep2();
      case MossAppState.Error:
        return html`Error!`;
      case MossAppState.Running:
        return html`
          <main-dashboard id="main-dashboard" .initialGroup=${this.initialGroup}></main-dashboard>
        `;
      default:
        return html`Unknown state`;
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

        .hint {
          font-size: 12px;
          color: #324d47;
          border-radius: 12px;
          background-color: var(--moss-light-green);
          padding: 10px 20px;
          width: 310px;
          font-weight: 500;
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

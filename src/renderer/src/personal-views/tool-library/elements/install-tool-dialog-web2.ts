import { css, html, LitElement } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { ActionHashB64 } from '@holochain/client';
import { localized, msg } from '@lit/localize';
import { ref } from 'lit/directives/ref.js';
import { joinAsyncMap, pipe, StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { notify, notifyError, onSubmit } from '@holochain-open-dev/elements';
import { slice } from '@holochain-open-dev/utils';

import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

import { groupStoreContext } from '../../../groups/context.js';
import { mossStyles } from '../../../shared-styles.js';
import { GroupStore } from '../../../groups/group-store.js';
import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';
import { ToolAndCurationInfo } from '../../../types.js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import { closeIcon } from '../../../elements/_new_design/icons.js';

@localized()
@customElement('install-tool-dialog-web2')
export class InstallToolDialogWeb2 extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  _registeredApplets = new StoreSubscriber(
    this,
    () =>
      pipe(this.groupStore.allAdvertisedApplets, (allAppletsHashes) =>
        joinAsyncMap(slice(this.groupStore.applets, allAppletsHashes)),
      ),
    () => [],
  );

  @query('#applet-dialog')
  _appletDialog!: any;

  @query('form')
  form!: HTMLFormElement;

  @state()
  _dnaBundle: { hash: ActionHashB64; file: File } | undefined = undefined;

  @state()
  _uiBundle: { hash: ActionHashB64; setupRenderers: any } | undefined = undefined;

  @state()
  _invalidUiBundle = false;

  @state()
  _duplicateName: boolean = false;

  @state()
  _installing: boolean = false;

  @state()
  _installationProgress: string | undefined;

  @state()
  _tool: ToolAndCurationInfo | undefined;

  @state()
  _showAdvanced: boolean = false;

  groupProfile = new StoreSubscriber(
    this,
    () => this.groupStore.groupProfile,
    () => [this.groupStore],
  );
  // _unlisten: UnlistenFn | undefined;

  async open(tool: ToolAndCurationInfo) {
    // reload all advertised applets
    await this.groupStore.allAdvertisedApplets.reload();
    this._tool = tool;
    setTimeout(() => {
      this.form.reset();
      this._appletDialog.show();
    }, 200);
  }

  close() {
    this.form.reset();
    this._tool = undefined;
    this._appletDialog.hide();
    this.dispatchEvent(
      new CustomEvent('install-tool-dialog-closed', {
        composed: true,
        bubbles: true,
      }),
    );
  }

  // disconnectedCallback(): void {
  //   if (this._unlisten) this._unlisten();
  // }

  get publishDisabled() {
    return this._duplicateName;
  }

  async installApplet(fields: { custom_name: string; network_seed?: string }) {
    if (this._installing) return;
    if (!this._tool) {
      notifyError('Tool undefined.');
      throw new Error('Tool undefined.');
    }
    this._installing = true;
    try {
      // Trigger the download of the icon
      // TODO convert icon to base64 and store it on disk
      this._installationProgress = 'Checking permission type...';
      const permissionType = await toPromise(this.groupStore.permissionType);
      if (permissionType.type === 'Member') {
        console.error('No valid permission to add a Tool to this group.');
        notifyError('No valid permission to add a Tool to this group.');
        this._appletDialog.hide();
        this._installing = false;
        this._installationProgress = undefined;
        return;
      }
      this._installationProgress = 'Downloading and installing Tool...';
      const appletEntryHash = await this.groupStore.installAndAdvertiseApplet(
        this._tool,
        fields.custom_name,
        fields.network_seed ? fields.network_seed : undefined,
        permissionType.type === 'Steward' ? permissionType.content.permission_hash : undefined,
      );

      // Add a timeout here to try to fix case where error "Applet not installed in any of the groups" occurs
      setTimeout(() => {
        notify('Installation successful');
        this.close();
        this.dispatchEvent(
          new CustomEvent('applet-installed', {
            detail: {
              appletEntryHash,
              groupDnaHash: this.groupStore.groupDnaHash,
            },
            composed: true,
            bubbles: true,
          }),
        );
        this._appletDialog.hide();
        this._installing = false;
        this._installationProgress = undefined;
      }, 200);
    } catch (e) {
      this._installationProgress = undefined;
      notifyError('Installation failed! (See console for details)');
      console.error(`Installation error: ${e}`);
      this._installing = false;
    }
  }

  renderForm() {
    if (!this._tool) return html`Error.`;

    switch (this._registeredApplets.value.status) {
      case 'pending':
        return html`<div class="row center-content">
          <sl-spinner></sl-spinner>
        </div>`;
      case 'complete':
        const allAppletsNames = Array.from(this._registeredApplets.value.value.values()).map(
          (applet) => applet?.custom_name,
        );
        return html`
          <div class="column install-form">
            <sl-input
              name="custom_name"
              class="moss-input"
              id="custom-name-field"
              .label=${msg('Custom Name')}
              style="margin-bottom: 16px"
              required
              ${ref((input) => {
                if (!input) return;
                setTimeout(() => {
                  if (
                    this._tool &&
                    allAppletsNames.includes(this._tool.toolInfoAndVersions.title)
                  ) {
                    (input as HTMLInputElement).setCustomValidity('Name already exists');
                  } else {
                    (input as HTMLInputElement).setCustomValidity('');
                  }
                });
              })}
              @input=${(e) => {
                if (allAppletsNames.includes(e.target.value)) {
                  e.target.setCustomValidity('Name already exists');
                } else if (e.target.value === '') {
                  e.target.setCustomValidity('You need to choose a name for the Tool instance.');
                } else {
                  e.target.setCustomValidity('');
                }
              }}
              .defaultValue=${this._tool.toolInfoAndVersions.title}
            ></sl-input>

            <span
              style="text-decoration: underline; cursor: pointer; margin-bottom: 10px;"
              @click=${() => {
                this._showAdvanced = !this._showAdvanced;
              }}
              >${this._showAdvanced ? 'Hide' : 'Show'} Advanced
            </span>

            ${this._showAdvanced
              ? html`
                  <sl-input
                    name="network_seed"
                    id="network-seed-field"
                    .label=${msg('Custom Network Seed')}
                    style="margin-bottom: 16px"
                  ></sl-input>
                `
              : html``}

            <div
              style="margin:0 20px 20px -120px; width: 673px; height:1px; flex-shrink: 0;background-color: var(--moss-grey-light)"
            >
              &nbsp;
            </div>
            <button class="moss-button ${this._installing ? 'loading' : ''}" type="submit">
              ${msg('Add to Group')}
            </button>
            <div>${this._installationProgress}</div>
          </div>
        `;

      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching the registered applets in this group')}
          .error=${this._registeredApplets.value.error}
        ></display-error>`;
    }
  }

  renderGroup() {
    switch (this.groupProfile.value.status) {
      case 'pending':
        return html`loading...`;
      case 'error':
        console.error('Error fetching the profile: ', this.groupProfile.value.error);
        return html`Error fetching the profile.`;
      case 'complete':
        const groupProfile = this.groupProfile.value.value;
        return html`
          &nbsp;<img
            .src=${groupProfile?.icon_src}
            alt="${groupProfile?.name}"
            style="height: 28px; width: 28px"
          />&nbsp;${groupProfile?.name}
        `;
    }
  }

  render() {
    return html`
      <sl-dialog
        id="applet-dialog"
        class="moss-dialog"
        .label=${msg('Add New Tool to Group')}
        no-header
        @sl-request-close=${(e) => {
          if (this._installing) {
            e.preventDefault();
          } else {
            this.dispatchEvent(
              new CustomEvent('install-tool-dialog-closed', {
                composed: true,
                bubbles: true,
              }),
            );
          }
        }}
      >
        <div style="margin: 0 100px">
          <div class="column dialog-title" style="margin: 60px 0 40px 0; position: relative;">
            <span style="display:flex;align-items:center;"
              >${msg('Installing to:')} ${this.renderGroup()}</span
            >

            <span>${msg('Heads-up!')}</span>
            <span>${msg('Give this app a custom name.')}</span>
            <button
              class="moss-dialog-close-button"
              style="position: absolute; top: -72px; right: -110px;"
              @click=${() => {
                if (!this._installing)
                  (this.shadowRoot?.getElementById('applet-dialog') as SlDialog).hide();
              }}
            >
              ${closeIcon(24)}
            </button>
          </div>

          <div class="form-text" style="margin-top: -20px; margin-bottom: 30px;">
            <span style="text-decoration: underline; font-weight: bold;">${msg('Note: ')}</span
            >${msg('Adding a new Tool to a group ')}<b>${msg(
              'creates a new unique instance ',
            )}</b>${msg(
              "of that Tool which other group members may join directly from the group's main page.",
            )}
            <sl-tooltip
              content=${msg(
                `Each time you add a Tool to a group via the Tool Library, you create a new unique peer-to-peer network specifically for that instance of the Tool. Other group members can only join the same network, if they join it from the group main page where it will show up for them in the "Joinable Tools" section. If two members each add the same Tool from the Tool Library, they create two independent peer-to-peer networks. In that way a group can have many independent instances of the same Tool.`,
              )}
            >
              <span style="margin-left: 3px; text-decoration: underline; color: blue; cursor: help;"
                >${msg('Details')}</span
              ></sl-tooltip
            >
          </div>
          <form class="column" ${onSubmit((f) => this.installApplet(f))}>${this.renderForm()}</form>
        </div>
      </sl-dialog>
    `;
  }

  static styles = [
    mossStyles,
    css`
      .online-dot {
        border-radius: 50%;
        width: 10px;
        height: 10px;
        margin-right: 10px;
      }

      .online {
        background-color: #17d310;
      }

      .offline {
        background-color: #bfbfbf;
      }

      .loading {
        display: none;
      }

      .form-text {
        color: rgba(0, 0, 0, 0.6);

        font-size: 16px;
        font-style: normal;
        font-weight: 400;
        line-height: 24px; /* 150% */
      }
      .install-form {
        margin-bottom: 10px;
      }

      #applet-dialog {
        --width: 674px;
        --height: 519px;
      }
    `,
  ];
}

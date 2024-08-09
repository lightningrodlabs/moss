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
import { weStyles } from '../../../shared-styles.js';
import { GroupStore } from '../../../groups/group-store.js';
import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';
import { Tool, UpdateableEntity } from '../types.js';

@localized()
@customElement('install-tool-dialog')
export class InstallToolDialog extends LitElement {
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
  _toolEntity: UpdateableEntity<Tool> | undefined;

  @state()
  _showAdvanced: boolean = false;

  // _unlisten: UnlistenFn | undefined;

  async open(toolEntity: UpdateableEntity<Tool>) {
    console.log('OPENING Tool APPLETINFO: ', toolEntity);
    // reload all advertised applets
    await this.groupStore.allAdvertisedApplets.reload();
    this._toolEntity = toolEntity;
    setTimeout(() => {
      this.form.reset();
      this._appletDialog.show();
    }, 200);
  }

  close() {
    this.form.reset();
    this._toolEntity = undefined;
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
    this._installing = true;
    try {
      // Trigger the download of the icon
      this._installationProgress = 'Fetching app icon...';
      await toPromise(
        this.mossStore.toolsLibraryStore.toolLogo.get(this._toolEntity!.originalActionHash),
      );
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
        this._toolEntity!,
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
    if (!this._toolEntity) return html`Error.`;

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
          <sl-input
            name="custom_name"
            id="custom-name-field"
            .label=${msg('Custom Name')}
            style="margin-bottom: 16px"
            required
            ${ref((input) => {
              if (!input) return;
              setTimeout(() => {
                if (
                  this._toolEntity &&
                  allAppletsNames.includes(this._toolEntity!.record.entry.title)
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
            .defaultValue=${this._toolEntity.record.entry.title}
          ></sl-input>

          <span
            style="text-decoration: underline; cursor: pointer; margin-bottom: 3px;"
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

          <sl-button variant="primary" type="submit" .loading=${this._installing}>
            ${msg('Add to Group')}
          </sl-button>
          <div>${this._installationProgress}</div>
        `;

      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching the registered applets in this group')}
          .error=${this._registeredApplets.value.error}
        ></display-error>`;
    }
  }

  render() {
    return html`
      <sl-dialog
        id="applet-dialog"
        .label=${msg('Add New Tool to Group')}
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
        <div style="margin-top: -20px; margin-bottom: 30px;">
          <span style="text-decoration: underline; font-weight: bold;">${msg('Note: ')}</span>${msg(
            'Adding a new Tool to a group ',
          )}<b>${msg('creates a new unique instance ')}</b>${msg(
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
      </sl-dialog>
    `;
  }

  static styles = [
    weStyles,
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

      sl-dialog {
        --sl-panel-background-color: var(--sl-color-tertiary-0);
      }
    `,
  ];
}

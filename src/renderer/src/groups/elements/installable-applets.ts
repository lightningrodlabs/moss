import { html, LitElement, css } from 'lit';
import { consume } from '@lit/context';
import { customElement, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { DnaHashB64, decodeHashFromBase64 } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import { InstallToolDialog } from './install-tool-dialog';
import './install-tool-dialog.js';
import './group-context.js';

import { weStyles } from '../../shared-styles.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { SelectGroupDialog } from '../../elements/select-group-dialog.js';
import '../../elements/select-group-dialog.js';
import TimeAgo from 'javascript-time-ago';
import '../../tool-bundles/elements/tool-publisher.js';
import { Tool, UpdateableEntity } from '../../tools-library/types.js';

@localized()
@customElement('installable-applets')
export class InstallableApplets extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  _installableApplets = new StoreSubscriber(
    this,
    () => this.mossStore.toolsLibraryStore.allInstallableTools,
    () => [],
  );

  @query('#applet-dialog')
  _installAppletDialog!: InstallToolDialog;

  @query('#select-group-dialog')
  _selectGroupDialog!: SelectGroupDialog;

  @state()
  _selectedGroupDnaHash: DnaHashB64 | undefined;

  @state()
  _selectedToolEntity: UpdateableEntity<Tool> | undefined;

  async firstUpdated() {}

  timeAgo = new TimeAgo('en-US');

  renderInstallableApplet(toolEntity: UpdateableEntity<Tool>) {
    return html`
      <sl-card
        tabindex="0"
        class="applet-card"
        style="height: 200px"
        @click=${async () => {
          this._selectedToolEntity = toolEntity;
          this._selectGroupDialog.show();
        }}
        @keypress=${async (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            this._selectedToolEntity = toolEntity;
            this._selectGroupDialog.show();
          }
        }}
      >
        <div slot="header" class="row" style="align-items: center; padding-top: 9px;">
          ${
            toolEntity.record.entry.icon
              ? html`<img
                  src=${toolEntity.record.entry.icon}
                  alt="${toolEntity.record.entry.title} applet icon"
                  style="height: 50px; width: 50px; border-radius: 5px; margin-right: 15px;"
                />`
              : html``
          }
          <span style="font-size: 18px;">${toolEntity.record.entry.title}</span>
        </div>
        <div class="column" style="flex: 1; margin-bottom: -5px;">
          <span style="flex: 1">${toolEntity.record.entry.subtitle}</span>
          <span style="display: flex; flex: 1;"></span>
          <span style="flex: 1; margin-top:5px"
            >
            <div style="font-size: 80%; margin-bottom: 5px;">
              Published ${this.timeAgo.format(toolEntity.record.action.timestamp)} by </span>
            </div>
            <tool-publisher .developerCollectiveHash=${toolEntity.record.entry.developer_collective}></tool-publisher>
          </span>
        </div>
      </sl-card>
    `;
  }

  renderApplets(allApplets: Array<UpdateableEntity<Tool>>) {
    const nonDeprecatedApplets = allApplets.filter((record) => !record.record.entry.deprecation);
    return html`
      <div
        style="display: flex; flex-direction: row; flex-wrap: wrap; align-content: flex-start; flex: 1;"
      >
        ${nonDeprecatedApplets.length === 0
          ? html`
              <div class="column center-content" style="flex: 1;">
                <span class="placeholder">${msg('No applets available yet.')}</span>
              </div>
            `
          : nonDeprecatedApplets.map((applet) => this.renderInstallableApplet(applet))}
      </div>
    `;
  }

  render() {
    switch (this._installableApplets.value?.status) {
      case 'pending':
        return html`<div class="row center-content" style="flex: 1;">
          <sl-spinner style="font-size: 2rem"></sl-spinner>
        </div>`;
      case 'complete':
        return html`
          ${this._selectedGroupDnaHash
            ? html`
                <group-context .groupDnaHash=${decodeHashFromBase64(this._selectedGroupDnaHash)}>
                  <install-tool-dialog
                    @install-tool-dialog-closed=${() => {
                      this._selectedGroupDnaHash = undefined;
                      this._selectedToolEntity = undefined;
                    }}
                    @applet-installed=${() => {
                      this._selectedGroupDnaHash = undefined;
                      this._selectedToolEntity = undefined;
                    }}
                    id="applet-dialog"
                  ></install-tool-dialog>
                </group-context>
              `
            : html``}
          <select-group-dialog
            id="select-group-dialog"
            @installation-group-selected=${(e: CustomEvent) => {
              this._selectedGroupDnaHash = e.detail;
              this._selectGroupDialog.hide();
              setTimeout(async () => this._installAppletDialog.open(this._selectedToolEntity!), 50);
            }}
          ></select-group-dialog>
          ${this.renderApplets(this._installableApplets.value.value)}
        `;
      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching the applets available for installation')}
          .error=${this._installableApplets.value.error}
        ></display-error>`;
    }
  }

  static styles = [
    css`
      sl-card::part(body) {
        padding-top: 5px;
      }

      .applet-card {
        width: 300px;
        height: 180px;
        margin: 10px;
        color: black;
        --border-radius: 15px;
        cursor: pointer;
        border: none;
        --border-color: transparent;
        --sl-panel-background-color: var(--sl-color-tertiary-100);
        --sl-shadow-x-small: 1px 1px 2px 0 var(--sl-color-tertiary-700);
      }

      .applet-card:hover {
        --sl-panel-background-color: var(--sl-color-tertiary-400);
      }

      .applet-card:focus {
        --sl-panel-background-color: var(--sl-color-tertiary-400);
      }
    `,
    weStyles,
  ];
}

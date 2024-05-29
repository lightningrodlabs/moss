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

import { InstallAppletBundleDialog } from './install-applet-bundle-dialog.js';
import './install-applet-bundle-dialog.js';
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
@customElement('installable-tools')
export class InstallableTools extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  _installableTools = new StoreSubscriber(
    this,
    () => this.mossStore.toolsLibraryStore.allInstallableTools,
    () => [],
  );

  @query('#applet-dialog')
  _installAppletDialog!: InstallAppletBundleDialog;

  @query('#select-group-dialog')
  _selectGroupDialog!: SelectGroupDialog;

  @state()
  _selectedGroupDnaHash: DnaHashB64 | undefined;

  @state()
  _selectedToolEntity: UpdateableEntity<Tool> | undefined;

  async firstUpdated() {}

  timeAgo = new TimeAgo('en-US');

  renderInstallableTool(toolEntity: UpdateableEntity<Tool>) {
    return html`
      <sl-card
        tabindex="0"
        class="tool-card"
        @click=${async () => {
          this.dispatchEvent(
            new CustomEvent('open-tool-detail', {
              detail: toolEntity,
              composed: true,
            }),
          );
        }}
        @keypress=${async (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            this.dispatchEvent(
              new CustomEvent('open-tool-detail', {
                detail: toolEntity,
                composed: true,
              }),
            );
          }
        }}
      >
        <div class="row" style="flex: 1;">
          ${toolEntity.record.entry.icon
            ? html`<img
                src=${toolEntity.record.entry.icon}
                alt="${toolEntity.record.entry.title} tool icon"
                style="height: 80px; width: 80px; border-radius: 10px; margin-right: 15px;"
              />`
            : html``}
          <div class="column">
            <div style="font-size: 18px; margin-top: 10px; font-weight: bold;">
              ${toolEntity.record.entry.title}
            </div>
            <div style="margin-top: 3px;">${toolEntity.record.entry.subtitle}</div>
          </div>
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
          : nonDeprecatedApplets.map((applet) => this.renderInstallableTool(applet))}
      </div>
    `;
  }

  render() {
    switch (this._installableTools.value?.status) {
      case 'pending':
        return html`<div class="row center-content" style="flex: 1;">
          <sl-spinner style="font-size: 2rem"></sl-spinner>
        </div>`;
      case 'complete':
        return html`
          ${this._selectedGroupDnaHash
            ? html`
                <group-context .groupDnaHash=${decodeHashFromBase64(this._selectedGroupDnaHash)}>
                  <install-applet-bundle-dialog
                    @install-applet-dialog-closed=${() => {
                      this._selectedGroupDnaHash = undefined;
                      this._selectedToolEntity = undefined;
                    }}
                    @applet-installed=${() => {
                      this._selectedGroupDnaHash = undefined;
                      this._selectedToolEntity = undefined;
                    }}
                    id="applet-dialog"
                  ></install-applet-bundle-dialog>
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
          ${this.renderApplets(this._installableTools.value.value)}
        `;
      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching the applets available for installation')}
          .error=${this._installableTools.value.error}
        ></display-error>`;
    }
  }

  static styles = [
    css`
      sl-card::part(body) {
        /* padding-top: 5px; */
      }

      .tool-card {
        width: 400px;
        margin: 10px;
        color: black;
        --border-radius: 15px;
        cursor: pointer;
        border: none;
        --border-color: transparent;
        --sl-panel-background-color: var(--sl-color-tertiary-100);
        --sl-shadow-x-small: 1px 1px 2px 0 var(--sl-color-tertiary-700);
      }

      .tool-card:hover {
        --sl-panel-background-color: var(--sl-color-tertiary-400);
      }

      .tool-card:focus {
        --sl-panel-background-color: var(--sl-color-tertiary-400);
      }
    `,
    weStyles,
  ];
}

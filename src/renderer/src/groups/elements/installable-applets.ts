import { html, LitElement, css } from 'lit';
import { consume } from '@lit/context';
import { customElement, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { asyncDeriveAndJoin, joinAsync, StoreSubscriber } from '@holochain-open-dev/stores';
import { DnaHashB64, decodeHashFromBase64 } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import { InstallAppletBundleDialog } from './install-applet-bundle-dialog.js';
import './install-applet-bundle-dialog.js';
import './group-context.js';

import { weStyles } from '../../shared-styles.js';
import { WeStore } from '../../we-store.js';
import { weStoreContext } from '../../context.js';
import { IconSrcOption } from '../../applet-bundles/types.js';
import { AppEntry, Entity } from '../../processes/appstore/types.js';
import { SelectGroupDialog } from '../../elements/select-group-dialog.js';
import '../../elements/select-group-dialog.js';

@localized()
@customElement('installable-applets')
export class InstallableApplets extends LitElement {
  @consume({ context: weStoreContext, subscribe: true })
  weStore!: WeStore;

  _installableApplets = new StoreSubscriber(
    this,
    () => this.weStore.appletBundlesStore.installableAppletBundles,
    () => [],
  );

  @query('#applet-dialog')
  _installAppletDialog!: InstallAppletBundleDialog;

  @query('#select-group-dialog')
  _selectGroupDialog!: SelectGroupDialog;

  @state()
  _selectedGroupDnaHash: DnaHashB64 | undefined;

  @state()
  _selectedAppEntry: Entity<AppEntry> | undefined;

  renderInstallableApplet(appEntry: Entity<AppEntry>) {
    return html`
      <sl-card
        tabindex="0"
        class="applet-card"
        style="height: 200px"
        @click=${async () => {
          this._selectedAppEntry = appEntry;
          this._selectGroupDialog.show();
        }}
        @keypress=${async (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            this._selectedAppEntry = appEntry;
            this._selectGroupDialog.show();
          }
        }}
      >
        <div slot="header" class="row" style="align-items: center; padding-top: 9px;">
          ${appEntry.content.icon_src
            ? html`<img
                src=${appEntry.content.icon_src}
                alt="${appEntry.content.title} applet icon"
                style="height: 50px; width: 50px; border-radius: 5px; margin-right: 15px;"
              />`
            : html``}
          <span style="font-size: 18px;">${appEntry.content.title}</span>
        </div>
        <div class="column" style="flex: 1">
          <span style="flex: 1">${appEntry.content.subtitle}</span>
        </div>
      </sl-card>
    `;
  }

  renderApplets(allApplets: Array<Entity<AppEntry>>) {
    const nonDeprecatedApplets = allApplets.filter((entity) => !entity.content.deprecation);
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
                  <install-applet-bundle-dialog
                    @install-applet-dialog-closed=${() => {
                      this._selectedGroupDnaHash = undefined;
                      this._selectedAppEntry = undefined;
                    }}
                    @applet-installed=${() => {
                      this._selectedGroupDnaHash = undefined;
                      this._selectedAppEntry = undefined;
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
              setTimeout(async () => this._installAppletDialog.open(this._selectedAppEntry!), 50);
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
      .applet-card {
        width: 300px;
        height: 180px;
        margin: 10px;
        --border-radius: 15px;
        cursor: pointer;
        border: none;
        --border-color: transparent;
      }

      .applet-card:hover {
        --sl-panel-background-color: var(--sl-color-primary-100);
      }

      .applet-card:focus {
        --sl-panel-background-color: var(--sl-color-primary-100);
      }
    `,
    weStyles,
  ];
}

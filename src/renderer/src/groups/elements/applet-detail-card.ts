import { AppInfo, DnaHash, EntryHash, encodeHashToBase64 } from '@holochain/client';
import { hashProperty, notify, wrapPathInSvg } from '@holochain-open-dev/elements';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg } from '@lit/localize';
import { mdiShareVariant, mdiTrashCanOutline } from '@mdi/js';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';

import { Applet } from '../../applets/types.js';
import { weStyles } from '../../shared-styles.js';
import { weStoreContext } from '../../context.js';
import { WeStore } from '../../we-store.js';
import {
  appIdFromAppletHash,
  dnaHashForCell,
  getCellNetworkSeed,
  getProvisionedCells,
  isAppRunning,
} from '../../utils.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';

@customElement('applet-detail-card')
export class AppletDetailCard extends LitElement {
  @consume({ context: weStoreContext, subscribe: true })
  weStore!: WeStore;

  appletUpdatable = new StoreSubscriber(
    this,
    () => this.weStore.appletUpdatable(this.appletHash),
    () => [this.weStore],
  );

  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  @property()
  applet!: Applet;

  @property()
  federatedGroups!: ReadonlyMap<EntryHash, Array<DnaHash>>;

  @state()
  appInfo: AppInfo | undefined;

  async firstUpdated() {
    this.appInfo = await this.weStore.appWebsocket.appInfo({
      installed_app_id: appIdFromAppletHash(this.appletHash),
    });
  }

  async updateUi() {
    this.dispatchEvent(
      new CustomEvent('update-ui', {
        bubbles: true,
        composed: true,
        detail: this.appletHash,
      }),
    );
  }

  async uninstallApplet() {
    this.dispatchEvent(
      new CustomEvent('uninstall-applet', {
        bubbles: true,
        composed: true,
        detail: this.appletHash,
      }),
    );
  }

  render() {
    if (!this.appInfo) return html``;
    return html`
      <sl-card class="applet-card">
        <div class="column" style="flex: 1;">
          <div class="row" style="flex: 1; align-items: center">
            <applet-logo .appletHash=${this.appletHash} style="margin-right: 16px"></applet-logo>
            <span style="flex: 1; font-size: 23px; font-weight: 600;"
              >${this.applet.custom_name}</span
            >
            ${!!this.appletUpdatable.value
              ? html`<sl-button
                  variant="success"
                  @click=${() => this.updateUi()}
                  @keypress=${(e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                      this.updateUi();
                    }
                  }}
                  title="Update Applet"
                  >Install Update</sl-button
                >`
              : html``}
            <sl-tooltip .content=${msg('Federate')}>
              <sl-icon-button
                .src=${wrapPathInSvg(mdiShareVariant)}
                style="font-size: 38px; margin-right: 10px;"
                @click=${() => {
                  this.dispatchEvent(
                    new CustomEvent('federate-applet', {
                      detail: this.appletHash,
                      bubbles: true,
                    }),
                  );
                }}
                @keypress=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter') {
                    this.dispatchEvent(
                      new CustomEvent('federate-applet', {
                        detail: this.appletHash,
                        bubbles: true,
                      }),
                    );
                  }
                }}
              ></sl-icon-button>
            </sl-tooltip>
            <sl-tooltip
              .content=${this.appInfo && isAppRunning(this.appInfo)
                ? msg('Disable')
                : msg('Enable')}
            >
              <sl-switch
                style="--sl-color-primary-600: #35bf20;"
                size="large"
                ?checked=${this.appInfo && isAppRunning(this.appInfo)}
                ?disabled=${!this.appInfo}
                @sl-change=${async () => {
                  if (this.appInfo && isAppRunning(this.appInfo)) {
                    await this.weStore.disableApplet(this.appletHash);
                    notify(msg('Applet disabled.'));
                  } else if (this.appInfo && !isAppRunning(this.appInfo)) {
                    await this.weStore.enableApplet(this.appletHash);
                    notify(msg('Applet enabled.'));
                  }
                }}
              >
              </sl-switch>
            </sl-tooltip>
          </div>
          <div class="row" style="margin-top: 15px;">
            <span><b>appletHash:&nbsp;</b></span
            ><span>${encodeHashToBase64(this.appletHash)}</span>
            <span style="flex: 1;"></span>
            ${this.federatedGroups.get(this.appletHash) &&
            this.federatedGroups.get(this.appletHash)!.length > 0
              ? html`<span style="margin-right: 5px; margin-bottom: 5px;">Federated with:</span>`
              : html`<div style="height: 30px;"></div>`}
          </div>
          <div class="row" style="justify-content: flex-end">
            ${Array.from(this.federatedGroups.get(this.appletHash)!).map(
              (groupDnaHash) => html`
                <group-context .groupDnaHash=${groupDnaHash}>
                  <group-logo
                    .groupDnaHash=${groupDnaHash}
                    style="margin-right: 8px; --size: 40px"
                  ></group-logo
                ></group-context>
              `,
            )}
          </div>
          <!-- Cells -->
          <div style="margin-top: 5px; margin-bottom: 3px;font-size: 20px;">
            <b>Cells:</b>
          </div>
          <div>
            ${this.appInfo
              ? getProvisionedCells(this.appInfo).map(
                  ([roleName, cellInfo]) => html`
                    <div class="column cell-card">
                      <div class="row" style="justify-content: flex-end;">
                        <span><b>${roleName} </b></span><br />
                      </div>
                      <div style="margin-bottom: 3px;">
                        <b>DNA hash:</b> ${dnaHashForCell(cellInfo)}
                      </div>
                      <div style="margin-bottom: 4px;">
                        <b>network seed:</b> ${getCellNetworkSeed(cellInfo)}
                      </div>
                    </div>
                  `,
                )
              : html``}
          </div>
          <div class="row" style="justify-content: flex-end; margin-top: 10px;">
            <sl-button
              variant="danger"
              @click=${() => this.uninstallApplet()}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  this.uninstallApplet();
                }
              }}
            >
              <div class="row center-content">
                <sl-icon
                  style="height: 20px; width: 20px;"
                  .src=${wrapPathInSvg(mdiTrashCanOutline)}
                ></sl-icon
                ><span style="margin-left: 5px;">Uninstall</span>
              </div>
            </sl-button>
          </div>
        </div>
      </sl-card>
    `;
  }

  static styles = [
    weStyles,
    css`
      .applet-card {
        flex: 1;
        margin-bottom: 16px;
        min-width: 800px;
        --border-radius: 15px;
      }
      .cell-card {
        border-radius: 10px;
        padding: 8px 12px;
        margin-top: 5px;
        box-shadow: 0 0 5px 0 black;
      }
    `,
  ];
}

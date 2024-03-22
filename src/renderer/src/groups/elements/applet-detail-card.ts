import { AgentPubKey, AppInfo, DnaHash, EntryHash, encodeHashToBase64 } from '@holochain/client';
import { hashProperty, notify, wrapPathInSvg } from '@holochain-open-dev/elements';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { mdiShareVariant, mdiTrashCanOutline } from '@mdi/js';

import '@holochain-open-dev/profiles/dist/elements/agent-avatar.js';
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
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';

import { Applet } from '../../types.js';
import { weStyles } from '../../shared-styles.js';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import {
  appIdFromAppletHash,
  dnaHashForCell,
  getCellNetworkSeed,
  getProvisionedCells,
  isAppRunning,
} from '../../utils.js';
import { StoreSubscriber, lazyLoadAndPoll } from '@holochain-open-dev/stores';
import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { dialogMessagebox } from '../../electron-api.js';

@localized()
@customElement('applet-detail-card')
export class AppletDetailCard extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  _appletUpdatable = new StoreSubscriber(
    this,
    () => this.mossStore.appletUpdatable(this.appletHash),
    () => [this.mossStore],
  );

  _joinedMembers = new StoreSubscriber(
    this,
    () =>
      lazyLoadAndPoll(
        () => this.groupStore.groupClient.getJoinedAppletAgents(this.appletHash),
        10000,
      ),
    () => [this.groupStore],
  );

  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  @property()
  applet!: Applet;

  @property()
  federatedGroups!: ReadonlyMap<EntryHash, Array<DnaHash>>;

  @state()
  addedBy: AgentPubKey | undefined;

  @state()
  appInfo: AppInfo | undefined | null;

  async firstUpdated() {
    this.appInfo = await this.mossStore.appWebsocket.appInfo({
      installed_app_id: appIdFromAppletHash(this.appletHash),
    });
    const appletRecord = await this.groupStore.groupClient.getPublicApplet(this.appletHash);
    if (appletRecord) {
      this.addedBy = appletRecord.action.author;
    }
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

  renderJoinedMembers() {
    switch (this._joinedMembers.value.status) {
      case 'error':
        console.error(
          'Failed to get members that joined the applet: ',
          this._joinedMembers.value.error,
        );
        return html`ERROR: See console for details.`;
      case 'pending':
        return html`<sl-spinner></sl-spinner>`;
      case 'complete':
        return html`
          ${this._joinedMembers.value.value.map(
            (appletAgent) => html`
              <agent-avatar
                style="margin-left: 5px;"
                .agentPubKey=${appletAgent.group_pubkey}
              ></agent-avatar>
            `,
          )}
        `;
    }
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
            ${!!this._appletUpdatable.value
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
                    const federatedGroups = await this.groupStore.groupClient.getFederatedGroups(
                      this.appletHash,
                    );
                    if (federatedGroups.length > 0) {
                      const confirmation = await dialogMessagebox({
                        message:
                          'WARNING: This Applet is federated with at least one other group. Disabling it will disable it for all groups.',
                        type: 'warning',
                        buttons: ['Cancel', 'Continue'],
                      });
                      if (confirmation.response === 0) {
                        await this.mossStore.reloadManualStores();
                        return;
                      }
                    }
                    await this.mossStore.disableApplet(this.appletHash);
                    notify(msg('Applet disabled.'));
                  } else if (this.appInfo && !isAppRunning(this.appInfo)) {
                    await this.mossStore.enableApplet(this.appletHash);
                    notify(msg('Applet enabled.'));
                  }
                }}
              >
              </sl-switch>
            </sl-tooltip>
          </div>
          <div class="row" style="margin-top: 15px; align-items: center;">
            <span><b>appletHash:&nbsp;</b></span
            ><span>${encodeHashToBase64(this.appletHash)}</span>
            <span style="flex: 1;"></span>
            ${this.federatedGroups.get(this.appletHash) &&
            this.federatedGroups.get(this.appletHash)!.length > 0
              ? html`<span style="margin-right: 5px; margin-bottom: 5px;">Federated with:</span>`
              : html`<div style="height: 30px;"></div>`}

            <div class="row" style="align-items: center;">
              <span><b>added by&nbsp;</b></span>
              ${this.addedBy
                ? html`<agent-avatar
                    style="margin-left: 5px;"
                    .agentPubKey=${this.addedBy}
                  ></agent-avatar>`
                : html`unknown`}
            </div>
          </div>
          <div class="row" style="align-items: center; margin-top: 4px;">
            <span><b>joined by:&nbsp;</b></span>
            ${this.renderJoinedMembers()}
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
                ><span style="margin-left: 5px;">${msg('Uninstall')}</span>
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

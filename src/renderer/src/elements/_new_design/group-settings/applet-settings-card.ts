import { ActionHash, AppInfo, encodeHashToBase64 } from '@holochain/client';
import { notify, wrapPathInSvg } from '@holochain-open-dev/elements';
import { css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { mdiTrashCanOutline } from '@mdi/js';

import '@holochain-open-dev/profiles/dist/elements/agent-avatar.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';

import '../copy-hash';
import '../../../applets/elements/applet-logo';

import { ALWAYS_ONLINE_TAG } from '@theweave/group-client';

import { StoreSubscriber } from '@holochain-open-dev/stores';
import { appIdFromAppletHash, isAppRunning } from '@theweave/utils';
import {
  dnaHashForCell,
  getCellNetworkSeed,
  getProvisionedCells,
} from '../../../utils.js';
import { chevronSingleDownIcon, chevronSingleUpIcon } from '../icons.js';
import { BaseAppletSettingsCard } from './base-applet-settings-card.js';

@localized()
@customElement('applet-settings-card')
export class AppletSettingsCard extends BaseAppletSettingsCard {
  _toolVersion = new StoreSubscriber(
    this,
    () => this.mossStore.appletToolVersion.get(this.appletHash),
    () => [this.mossStore, this.appletHash],
  );

  @state()
  appInfo: AppInfo | undefined | null;


  protected async onAfterFirstUpdated(): Promise<void> {
    const [appletClient, _] = await this.mossStore.getAppClient(
      appIdFromAppletHash(this.appletHash),
    );
    this.appInfo = await appletClient.appInfo();
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

  // TODO: use MossPrivilege instead
  async toggleAlwaysOnlineNodesSetting() {
    console.log('this.groupAppletsMetaData.value', this.groupAppletsMetaData.value);
    console.log('amIPrivileged: ', this.amIPrivileged());
    if (this.groupAppletsMetaData.value.status !== 'complete' || !this.amIPrivileged()) {
      return;
    }
    console.log('Changing setting.');
    const groupAppletsMetaData = this.groupAppletsMetaData.value.value || {};
    const appletId = encodeHashToBase64(this.appletHash);
    const appletMetaData = groupAppletsMetaData[appletId]
      ? groupAppletsMetaData[appletId]
      : { tags: [] };

    let message = '';
    if (appletMetaData.tags.includes(ALWAYS_ONLINE_TAG)) {
      appletMetaData.tags = appletMetaData.tags.filter((tag) => tag !== ALWAYS_ONLINE_TAG);
      message = msg('Disabled.');
    } else {
      appletMetaData.tags = [...appletMetaData.tags, ALWAYS_ONLINE_TAG];
      message = msg('Enabled.');
    }

    groupAppletsMetaData[appletId] = appletMetaData;
    const permissionHash = this.getMyPermissionHash();
    await this.groupStore.groupClient.setGroupAppletsMetaData(permissionHash, groupAppletsMetaData);
    notify(message);
    await this.groupStore.groupAppletsMetaData.reload();
  }

  // TODO: use MossPrivilege instead
  getMyPermissionHash(): ActionHash | undefined {
    if (this.myAccountabilities.value.status !== 'complete') {
      return undefined;
    }
    for (const acc of this.myAccountabilities.value.value) {
      if (acc.type === 'Steward') {
        return acc.content.permission_hash;
      }
    }
    return undefined;
  }

  toolVersion() {
    switch (this._toolVersion.value.status) {
      case 'error':
        console.error("Failed to get tool's version: ", this._toolVersion.value.error);
        return 'unknown';
      case 'pending':
        return 'unknown';
      case 'complete':
        return this._toolVersion.value.value;
    }
  }



  renderMetaSettings() {
    if (this.groupAppletsMetaData.value.status === 'error') {
      console.log('Failed to get group applets metadata: ', this.groupAppletsMetaData.value.error);
    }
    const isSteward = this.groupAppletsMetaData.value.status === 'complete' && this.amIPrivileged();
    const alwaysOnlineEnabled = this.groupAppletsMetaData.value.status === 'complete'
      ? this.alwaysOnlineNodesShouldInstall(this.groupAppletsMetaData.value.value)
      : false;

    return html`
      <!-- Cells -->
      <div style="margin-top: 5px; margin-bottom: 3px; color:#89D6AA">
        // Cells:
      </div>
      <div>
        ${this.appInfo
        ? getProvisionedCells(this.appInfo).map(
          ([roleName, cellInfo]) => html`
                  <div class="column cell-card">
                    <div class="row" style="justify-content: flex-start;">
                      <span><b>${roleName} </b></span><br />
                    </div>
                    <div class="row  items-center" style="margin-bottom: 3px;">
                      DNA hash: <copy-hash styles="color:#E7EEC4;font-size:12px;" .hash=${dnaHashForCell(cellInfo)}></copy-hash>
                    </div>
                    <div class="row items-center" style="margin-bottom: 4px;">
                      network seed: <copy-hash styles="color:#E7EEC4;font-size:12px;" .hash=${getCellNetworkSeed(cellInfo)}></copy-hash>
                    </div>
                  </div>
                `,
        )
        : html``}

          <div class="row items-center">
            ${isSteward
        ? html`
                  <sl-switch
                    style="--sl-color-primary-600: #89D6AA; margin-bottom: 5px;"
                    size="large"
                    ?checked=${alwaysOnlineEnabled}
                    @sl-change=${async () => this.toggleAlwaysOnlineNodesSetting()}
                  >
                  </sl-switch>
                  <span>${msg('Allways-online nodes should install this tool by default')}</span>
                `
        : html`
                  <span style="margin-right: 5px;">${alwaysOnlineEnabled ? msg('Enabled') : msg('Disabled')}:</span>
                  <span>${msg('Allways-online nodes should install this tool by default')}</span>
                `}
          </div>
      </div>
    `;
  }


  render() {
    if (!this.appInfo) return html``;
    return super.render();
  }

  protected getInnerContainerStyle(): string {
    return 'flex: 1;';
  }

  protected renderTitleBarContent() {
    return html`
      <applet-logo
        .appletHash=${this.appletHash}
        style="margin-right: 16px; --size: 64px;"
      ></applet-logo>
      <div class="column">
        <div class="tool-name">
          ${this.applet.custom_name} <span class="tool-version"> v${this.toolVersion()}</span>
        </div>
        <div class="tool-short-description">${this.applet.subtitle}</div>
      </div>

      <span style="flex: 1;"></span>
      <span style="margin-right: 5px; font-size: 14px;">
        ${this.appInfo && isAppRunning(this.appInfo) ? msg('enabled') : msg('disabled')}
      </span>
      <sl-tooltip
        .content=${this.appInfo && isAppRunning(this.appInfo)
        ? msg('Disable the app for yourself')
        : msg('Enable')}
      >
        <sl-switch
          style="--sl-color-primary-600: #35bf20; margin-bottom: 5px;"
          size="medium"
          ?checked=${this.appInfo && isAppRunning(this.appInfo)}
          ?disabled=${!this.appInfo}
          @sl-change=${async () => {
        if (this.appInfo && isAppRunning(this.appInfo)) {
          await this.mossStore.disableApplet(this.appletHash);
          this.dispatchEvent(
            new CustomEvent('applets-disabled', {
              detail: [this.appletHash],
              bubbles: true,
              composed: true,
            }),
          );
          notify(msg('Tool disabled.'));
        } else if (this.appInfo && !isAppRunning(this.appInfo)) {
          await this.mossStore.enableApplet(this.appletHash);
          notify(msg('Tool enabled.'));
        }
      }}
        >
        </sl-switch>
      </sl-tooltip>
      <div style="margin-left:24px">
        ${this.showDetails ? chevronSingleDownIcon(18) : chevronSingleUpIcon(18)}
      </div>
    `;
  }

  protected renderDetailsActions() {
    if (!this.appInfo) return html``;
    return html`
      ${this.renderAdvancedSettingsToggle()}

      <div class="row">
        <sl-tooltip content=${msg('Uninstall this Tool for yourself (irreversible)')}>
          <moss-mini-button
            variant="secondary"
            color="#7D7438"
            style=" margin-right:8px;"
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
              ><span style="margin-left: 5px;">${msg('Uninstall for me')}</span>
            </div>
          </moss-mini-button>
        </sl-tooltip>

        ${this.renderDeprecateButton()}
      </div>
    `;
  }

  protected renderAdvancedSectionContent() {
    if (!this.appInfo) return html``;
    return html`
      ${this.renderMetaSettings()}
    `;
  }

  static styles = [
    ...BaseAppletSettingsCard.styles,
    css`
      .cell-card {
        border-radius: 10px;
        padding: 8px 12px;
        margin-top: 5px;
        box-shadow: 0 0 5px 0 black;
      }
    `,
  ];
}

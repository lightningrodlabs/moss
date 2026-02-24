import { AgentPubKey, AppInfo, EntryHash, encodeHashToBase64, ActionHash } from '@holochain/client';
import { hashProperty, notify, notifyError, wrapPathInSvg } from '@holochain-open-dev/elements';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { mdiArchiveArrowDownOutline, mdiArchiveArrowUpOutline, mdiTrashCanOutline } from '@mdi/js';

import '@holochain-open-dev/profiles/dist/elements/agent-avatar.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';

import { ALWAYS_ONLINE_TAG, Applet, GroupAppletsMetaData } from '@theweave/group-client';
import { mossStyles } from '../../shared-styles.js';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import {
  dnaHashForCell,
  getCellNetworkSeed,
  getProvisionedCells,
} from '../../utils.js';
import { StoreSubscriber, lazyLoadAndPoll } from '@holochain-open-dev/stores';
import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { appIdFromAppletHash, isAppRunning } from '@theweave/utils';
import {
  selectDevUiWebhapp,
  setDevUiOverride,
  clearDevUiOverride,
  getDevUiOverride,
} from '../../electron-api.js';

@localized()
@customElement('applet-detail-card')
export class AppletDetailCard extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  _joinedMembers = new StoreSubscriber(
    this,
    () => this.groupStore.joinedAppletAgents.get(this.appletHash)!,
    () => [this.groupStore, this.appletHash],
  );

  _abandonedMembers = new StoreSubscriber(
    this,
    () =>
      lazyLoadAndPoll(
        () => this.groupStore.groupClient.getAbandonedAppletAgents(this.appletHash),
        20000,
        () => this.groupStore.groupClient.getAbandonedAppletAgents(this.appletHash, true),
      ),
    () => [this.groupStore],
  );

  _allAdvertisedApplets = new StoreSubscriber(
    this,
    () => this.groupStore.allAdvertisedApplets,
    () => [this.groupStore],
  );

  myAccountabilities = new StoreSubscriber(
    this,
    () => this.groupStore.myAccountabilities,
    () => [this.groupStore],
  );

  groupAppletsMetaData = new StoreSubscriber(
    this,
    () => this.groupStore.groupAppletsMetaData,
    () => [this.groupStore],
  );

  _toolVersion = new StoreSubscriber(
    this,
    () => this.mossStore.appletToolVersion.get(this.appletHash)!,
    () => [this.mossStore, this.appletHash],
  );

  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  @property()
  applet!: Applet;

  @state()
  addedBy: AgentPubKey | undefined;

  @state()
  appInfo: AppInfo | undefined | null;

  @state()
  showAdvanced = false;

  @state()
  _hasDevOverride = false;

  @state()
  _devOverrideLoading = false;

  // TODO: Use MossPrivilege instead
  amIPrivileged() {
    if (this.myAccountabilities.value.status !== 'complete') {
      return false;
    }
    for (const acc of this.myAccountabilities.value.value) {
      if (acc.type === 'Steward' || acc.type == 'Progenitor') {
        return true;
      }
    }
    return false;
  }

  // TODO: Use MossPrivilege instead
  canIArchive() {
    // added by me
    if (!!this.addedBy
      && encodeHashToBase64(this.addedBy) === encodeHashToBase64(this.groupStore.groupClient.myPubKey)) {
        return true;
    }
    // progenitor
    if (this.myAccountabilities.value.status !== 'complete') {
      return false;
    }
    for (const acc of this.myAccountabilities.value.value) {
      if (acc.type == 'Progenitor') {
        return true;
      }
    }
    return false;
  }

  archiveState(): 'archived' | 'notArchived' | undefined {
    if (this._allAdvertisedApplets.value.status !== 'complete') return undefined;
    return this._allAdvertisedApplets.value.value
      .map((hash) => encodeHashToBase64(hash))
      .includes(encodeHashToBase64(this.appletHash))
      ? 'notArchived'
      : 'archived';
  }

  /**
   * Whether this applet is set for always-online nodes to install
   *
   * @param metaData
   * @returns
   */
  alwaysOnlineNodesShouldInstall(metaData: GroupAppletsMetaData | undefined): boolean {
    if (!metaData) return false;
    const appletMetaData = metaData[encodeHashToBase64(this.appletHash)];
    if (appletMetaData && appletMetaData.tags && appletMetaData.tags.includes(ALWAYS_ONLINE_TAG))
      return true;
    return false;
  }

  async firstUpdated() {
    const appId = appIdFromAppletHash(this.appletHash);
    const [appletClient, _] = await this.mossStore.getAppClient(appId);
    this.appInfo = await appletClient.appInfo();
    const appletRecord = await this.groupStore.groupClient.getPublicApplet(this.appletHash);
    if (appletRecord) {
      this.addedBy = appletRecord.action.author;
    }
    try {
      const result = await getDevUiOverride(appId);
      this._hasDevOverride = result.active;
    } catch (e) {
      console.warn('Failed to check dev UI override:', e);
    }
  }

  async applyDevUiOverride() {
    this._devOverrideLoading = true;
    try {
      const webhappPath = await selectDevUiWebhapp();
      if (!webhappPath) {
        this._devOverrideLoading = false;
        return;
      }

      const appId = appIdFromAppletHash(this.appletHash);
      const result = await setDevUiOverride(appId, webhappPath);

      if (!result.happHashMatch) {
        notify(msg('Warning: The DNA in this .webhapp differs from the installed version. The UI may not work correctly.'));
      }

      this._hasDevOverride = true;
      notify(msg('Dev UI override applied. Reload the tool to see the new UI.'));
    } catch (e) {
      notifyError(msg('Failed to apply dev UI override (see console for details)'));
      console.error(e);
    }
    this._devOverrideLoading = false;
  }

  async removeDevUiOverride() {
    this._devOverrideLoading = true;
    try {
      const appId = appIdFromAppletHash(this.appletHash);
      await clearDevUiOverride(appId);
      this._hasDevOverride = false;
      notify(msg('Dev UI override removed. Reload the tool to see the production UI.'));
    } catch (e) {
      notifyError(msg('Failed to clear dev UI override (see console for details)'));
      console.error(e);
    }
    this._devOverrideLoading = false;
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

  async archiveApplet() {
    try {
      await this.groupStore.groupClient.archiveApplet(this.appletHash);
      await this.groupStore.allAdvertisedApplets.reload();
      notify(msg('Tool archived.'));
    } catch (e) {
      notifyError(msg('Failed to archive Tool (see console for details)'));
      console.error(e);
    }
  }

  async unArchiveApplet() {
    try {
      await this.groupStore.groupClient.unarchiveApplet(this.appletHash);
      await this.groupStore.allAdvertisedApplets.reload();
      notify(msg('Tool unarchived.'));
    } catch (e) {
      notifyError(msg('Failed to unarchive Tool (see console for details)'));
      console.error(e);
    }
  }

  // TODO: use MossPrivilege instead
  async toggleAlwaysOnlineNodesSetting() {
    console.log('this.groupAppletsMetaData.value', this.groupAppletsMetaData.value);
    console.log('amIPrivileged: ', this.amIPrivileged());
    if (
      this.groupAppletsMetaData.value.status !== 'complete'
      || !this.amIPrivileged()
    )
      return;
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
    const myPermissionHash = this.getMyPermissionHash();
    await this.groupStore.groupClient.setGroupAppletsMetaData(myPermissionHash, groupAppletsMetaData);
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
        console.error(
          'Failed to get members that joined the applet: ',
          this._toolVersion.value.error,
        );
        return 'unknown';
      case 'pending':
        return 'unknown';
      case 'complete':
        return this._toolVersion.value.value;
    }
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

  renderAbandonedMembers() {
    switch (this._abandonedMembers.value.status) {
      case 'error':
        console.error(
          'Failed to get members that abandoned the applet: ',
          this._abandonedMembers.value.error,
        );
        return html`ERROR: See console for details.`;
      case 'pending':
        return html`<sl-spinner></sl-spinner>`;
      case 'complete':
        if (this._abandonedMembers.value.value.length === 0) return html``;
        return html`
          <div class="row" style="align-items: center; margin-top: 4px;">
            <span><b>${msg('abandoned by:')}&nbsp;</b></span>
            ${this._abandonedMembers.value.value.map(
          (appletAgent) => html`
                <agent-avatar
                  style="margin-left: 5px;"
                  .agentPubKey=${appletAgent.group_pubkey}
                ></agent-avatar>
              `,
        )}
          </div>
        `;
    }
  }

  renderDevUiOverride() {
    if (!this.amIPrivileged()) return html``;
    return html`
      <div class="row items-center" style="margin-top: 8px;">
        <span>${msg('Dev UI Override')}</span>
        <span class="flex flex-1"></span>
        ${this._devOverrideLoading
          ? html`<sl-spinner style="margin-right: 8px;"></sl-spinner>`
          : this._hasDevOverride
            ? html`
                <span class="dev-override-badge">${msg('DEV')}</span>
                <sl-button
                  variant="warning"
                  size="small"
                  style="margin-left: 8px;"
                  @click=${() => this.applyDevUiOverride()}
                >${msg('Replace')}</sl-button>
                <sl-button
                  variant="neutral"
                  size="small"
                  style="margin-left: 8px;"
                  @click=${() => this.removeDevUiOverride()}
                >${msg('Clear Override')}</sl-button>
              `
            : html`
                <sl-button
                  variant="neutral"
                  size="small"
                  @click=${() => this.applyDevUiOverride()}
                >${msg('Override from .webhapp')}</sl-button>
              `
        }
      </div>
    `;
  }

  renderMetaSettings() {
    if (this.groupAppletsMetaData.value.status === 'error') {
      console.log('Failed to get group applets metadata: ', this.groupAppletsMetaData.value.error);
    }
    if (this.groupAppletsMetaData.value.status !== 'complete' || !this.amIPrivileged()) return html``;
    return html`
      <div class="column meta-settings">
        <div class="font-bold">${msg('Advanced Settings')}</div>
        <div class="row items-center">
          <span>${msg('Always-online nodes should install this tool by default')}</span>
          <span class="flex flex-1"></span>
          <sl-switch
            style="--sl-color-primary-600: #e5d825; margin-bottom: 5px;"
            size="large"
            ?checked=${this.alwaysOnlineNodesShouldInstall(this.groupAppletsMetaData.value.value)}
            @sl-change=${async () => this.toggleAlwaysOnlineNodesSetting()}
          >
          </sl-switch>
        </div>
        ${this.renderDevUiOverride()}
      </div>
    `;
  }

  renderArchiveButton() {
    if (!this.canIArchive()) return html``;
    switch (this.archiveState()) {
      case 'notArchived':
        return html`
          <sl-tooltip
            content=${msg(
          'Deprecating will hide tool for activation by new members',
        )}
          >
            <sl-button
              variant="warning"
              style="margin-right: 5px;"
              @click=${() => this.archiveApplet()}
              @keypress=${async (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              this.archiveApplet();
            }
          }}
            >
              <div class="row center-content">
                <sl-icon
                  style="height: 20px; width: 20px;"
                  .src=${wrapPathInSvg(mdiArchiveArrowDownOutline)}
                ></sl-icon
                ><span style="margin-left: 5px;">${msg('Archive')}</span>
              </div>
            </sl-button>
          </sl-tooltip>
        `;
      case 'archived':
        return html`
          <sl-tooltip
            content=${msg(
          'Undeprecate this Tool for it to show up again for new members',
        )}
          >
            <sl-button
              variant="neutral"
              style="margin-right: 5px;"
              @click=${() => this.unArchiveApplet()}
              @keypress=${async (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              this.unArchiveApplet();
            }
          }}
            >
              <div class="row center-content">
                <sl-icon
                  style="height: 20px; width: 20px;"
                  .src=${wrapPathInSvg(mdiArchiveArrowUpOutline)}
                ></sl-icon
                ><span style="margin-left: 5px;">${msg('Unarchive')}</span>
              </div>
            </sl-button>
          </sl-tooltip>
        `;
      default:
        return html``;
    }
  }

  render() {
    if (!this.appInfo) return html``;
    return html`
      <sl-card
        class="applet-card"
        style="position: relative; ${this.archiveState() === 'archived' ? 'opacity: 0.6' : ''}"
      >
        ${this.archiveState() === 'archived'
        ? html`<span class="font-bold" style="position: absolute; top: 11px; right: 16px;"
              >${msg('ARCHIVED')}</span
            > `
        : html``}

        <div class="column" style="flex: 1;">
          <div class="row" style="flex: 1; align-items: center">
            <applet-logo .appletHash=${this.appletHash} style="margin-right: 16px"></applet-logo>
            <span style="font-size: 23px; font-weight: 600;">${this.applet.custom_name}</span>
            <span style="font-size: 20px; opacity: 0.7; margin-left: 10px; margin-bottom: -2px;"
              >${this.toolVersion()}</span
            >
            <span style="flex: 1;"></span>
            <span style="margin-right: 5px; font-weight;">
              ${this.appInfo && isAppRunning(this.appInfo) ? msg('enabled') : msg('disabled')}
            </span>
            <sl-tooltip
              .content=${this.appInfo && isAppRunning(this.appInfo)
        ? msg('Disable the app for yourself')
        : msg('Enable')}
            >
              <sl-switch
                style="--sl-color-primary-600: #35bf20; margin-bottom: 5px;"
                size="large"
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
          </div>
          <div class="row" style="margin-top: 15px; align-items: center;">
            <span><b>appletHash:&nbsp;</b></span
            ><span>${encodeHashToBase64(this.appletHash)}</span>
            <span style="flex: 1;"></span>

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

          ${this.renderAbandonedMembers()}

          <div class="row" style="margin-top: 10px; align-items: flex-end;">
            <div class="row">
              <button
                @click=${() => {
        this.showAdvanced = !this.showAdvanced;
      }}
                style="all: unset; cursor: pointer;"
              >
                ${this.showAdvanced ? msg('Hide Advanced Settings') : msg('Show Advanced Settings')}
              </button>
            </div>
            <span class="flex flex-1"></span>
            ${this.renderArchiveButton()}

            <sl-tooltip content=${msg('Uninstall this Tool for yourself (irreversible)')}>
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
            </sl-tooltip>
          </div>

          ${this.showAdvanced
        ? html`
                ${this.renderMetaSettings()}
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
              `
        : html``}
        </div>
      </sl-card>
    `;
  }

  static styles = [
    mossStyles,
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
      .meta-settings {
        background: #cdcdcd;
        border-radius: 10px;
        padding: 5px 10px;
        margin: 15px 0 10px 0;
      }
      .dev-override-badge {
        background: #e65100;
        color: white;
        font-size: 11px;
        font-weight: bold;
        padding: 2px 8px;
        border-radius: 4px;
      }
    `,
  ];
}

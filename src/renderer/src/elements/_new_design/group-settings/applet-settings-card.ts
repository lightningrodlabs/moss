import { AgentPubKey, AppInfo, EntryHash, encodeHashToBase64 } from '@holochain/client';
import { hashProperty, notify, wrapPathInSvg } from '@holochain-open-dev/elements';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { mdiArchiveArrowUpOutline, mdiTrashCanOutline } from '@mdi/js';

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

import { ALWAYS_ONLINE_TAG, Applet, GroupAppletsMetaData } from '@theweave/group-client';

import { StoreSubscriber, lazyLoadAndPoll } from '@holochain-open-dev/stores';
import { appIdFromAppletHash, isAppRunning } from '@theweave/utils';
import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';
import { groupStoreContext } from '../../../groups/context.js';
import { GroupStore } from '../../../groups/group-store.js';
import { mossStyles } from '../../../shared-styles.js';
import { toolSettingsStyles } from './tool-settings-styles.js';
import {
  dnaHashForCell,
  getCellNetworkSeed,
  getProvisionedCells,
} from '../../../utils.js';
import { chevronSingleDownIcon, chevronSingleUpIcon, deprecateIcon, devIcon } from '../icons.js';
import { deprecateTool, undeprecateTool } from './tool-settings-utils';

@localized()
@customElement('applet-settings-card')
export class AppletSettingsCard extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  _joinedMembers = new StoreSubscriber(
    this,
    () =>
      lazyLoadAndPoll(
        () => this.groupStore.groupClient.getJoinedAppletAgents(this.appletHash),
        20000,
        () => this.groupStore.groupClient.getJoinedAppletAgents(this.appletHash, true),
      ),
    () => [this.groupStore],
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

  permissionType = new StoreSubscriber(
    this,
    () => this.groupStore.permissionType,
    () => [this.groupStore],
  );

  groupAppletsMetaData = new StoreSubscriber(
    this,
    () => this.groupStore.groupAppletsMetaData,
    () => [this.groupStore],
  );

  _toolVersion = new StoreSubscriber(
    this,
    () => this.mossStore.appletToolVersion.get(this.appletHash),
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
  showDetails = false;

  amISteward() {
    if (
      this.permissionType.value.status === 'complete' &&
      ['Progenitor', 'Steward'].includes(this.permissionType.value.value.type)
    )
      return true;
    return false;
  }

  canIArchive() {
    const addedByMe =
      !!this.addedBy &&
      encodeHashToBase64(this.addedBy) === encodeHashToBase64(this.groupStore.groupClient.myPubKey);
    const iAmProgenitor =
      this.permissionType.value.status === 'complete' &&
      this.permissionType.value.value.type === 'Progenitor';
    if (iAmProgenitor || addedByMe) return true;
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
    const [appletClient, _] = await this.mossStore.getAppClient(
      appIdFromAppletHash(this.appletHash),
    );
    this.appInfo = await appletClient.appInfo();
    const appletRecord = await this.groupStore.groupClient.getPublicApplet(this.appletHash);
    if (appletRecord) {
      this.addedBy = appletRecord.action.author;
    }
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

  async toggleAlwaysOnlineNodesSetting() {
    console.log('this.groupAppletsMetaData.value', this.groupAppletsMetaData.value);
    console.log('amISteward: ', this.amISteward());
    if (
      this.groupAppletsMetaData.value.status !== 'complete' ||
      !this.amISteward() ||
      this.permissionType.value.status !== 'complete' ||
      !['Progenitor', 'Steward'].includes(this.permissionType.value.value.type)
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
    const permissionHash =
      this.permissionType.value.value.type === 'Steward'
        ? this.permissionType.value.value.content.permission_hash
        : undefined;
    await this.groupStore.groupClient.setGroupAppletsMetaData(permissionHash, groupAppletsMetaData);
    notify(message);
    await this.groupStore.groupAppletsMetaData.reload();
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

  renderJoinedMembers() {
    switch (this._joinedMembers.value.status) {
      case 'error':
        console.error(
          'Failed to get members that activated this tool: ',
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
          'Failed to get members that abandoned the tool: ',
          this._abandonedMembers.value.error,
        );
        return html`ERROR: See console for details.`;
      case 'pending':
        return html`<sl-spinner></sl-spinner>`;
      case 'complete':
        if (this._abandonedMembers.value.value.length === 0) return html``;
        return html`
          <div class="row items-center" style="margin-top: 4px;">
            <span>Abandoned by: </span>
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

  renderMetaSettings() {
    if (this.groupAppletsMetaData.value.status === 'error') {
      console.log('Failed to get group applets metadata: ', this.groupAppletsMetaData.value.error);
    }
    if (this.groupAppletsMetaData.value.status !== 'complete' || !this.amISteward()) return html``;
    return html`
      <div class="column meta-settings"
        @click=${(e: MouseEvent) => {
        e.stopPropagation();
        this.showAdvanced = !this.showAdvanced;
      }}      >
        <div style="color:#89D6AA">${devIcon(16)} ${msg('Advanced Settings')}</div>
        <div class="row items-center">
          <div class="row items-center">
            <span style="margin-left:8px; margin-bottom: 4px; margin-top: 4px;">${msg('applet hash')}:</span>
            <div class="row">
              <copy-hash styles="color:#E7EEC4" .hash=${encodeHashToBase64(this.appletHash)}></copy-hash>
            </div>
          </div>
        </div>
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
            <sl-switch
              style="--sl-color-primary-600: #e5d825; margin-bottom: 5px;"
              size="large"
              ?checked=${this.alwaysOnlineNodesShouldInstall(this.groupAppletsMetaData.value.value)}
              @sl-change=${async () => this.toggleAlwaysOnlineNodesSetting()}
            >
            </sl-switch>
            <span>${msg('Allways-online nodes should install this tool by default')}</span>
          <div>
        </div>
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
          'Deprecating will hide this tool from new members for activation; existing members will see it as deprecated.',
        )}
          >
            <moss-mini-button
              variant="secondary"
              color="#C35C1D"
              style="margin-right: 5px;"
              @click=${() => deprecateTool(this.groupStore, this.appletHash)}
              @keypress=${async (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              deprecateTool(this.groupStore, this.appletHash);
            }
          }}
            >
              <div class="row center-content">
                ${deprecateIcon(18)}
                <span style="margin-left: 5px;">${msg('Deprecate for Group')}</span>
              </div>
            </moss-mini-button>
          </sl-tooltip>
        `;
      case 'archived':
        return html`
          <sl-tooltip content=${msg('Remove deprecation tag for this tool.')}>
            <moss-mini-button
              variant="secondary"
              style="margin-right: 5px;"
              @click=${() => undeprecateTool(this.groupStore, this.appletHash)}
              @keypress=${async (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              undeprecateTool(this.groupStore, this.appletHash);
            }
          }}
            >
              <div class="row center-content">
                <sl-icon
                  style="height: 20px; width: 20px;"
                  .src=${wrapPathInSvg(mdiArchiveArrowUpOutline)}
                ></sl-icon
                ><span style="margin-left: 5px;">${msg('Undeprecate')}</span>
              </div>
            </moss-mini-button>
          </sl-tooltip>
        `;
      default:
        return html``;
    }
  }

  render() {
    if (!this.appInfo) return html``;
    return html`
      <div
        class="column tool flex-1 ${this.showDetails ? 'tool-expanded' : ''}"
        style="position: relative; ${this.archiveState() === 'archived' ? 'opacity: 0.6' : ''}"
        @click=${(e) => {
        e.stopPropagation();
        this.showDetails = !this.showDetails;
      }}
        @keypress=${(e) => {
        e.stopPropagation();
      }}
      >
        ${this.archiveState() === 'archived'
        ? html`<span class="tool-deprecated" style="position: absolute; top: 2px; right: 2px;"
              >${msg('Deprecated')}</span
            > `
        : html``}

        <div class="column" style="flex: 1;">
          <div
            class="row title-bar flex-1 items-center"
            tabindex="0"
            @click=${(e) => {
        e.stopPropagation();
        this.showDetails = !this.showDetails;
      }}
            @keypress=${(e) => {
        e.stopPropagation();
        this.showDetails = !this.showDetails;
      }}
          >
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
          notify(msg('Applet disabled.'));
        } else if (this.appInfo && !isAppRunning(this.appInfo)) {
          await this.mossStore.enableApplet(this.appletHash);
          notify(msg('Applet enabled.'));
        }
      }}
              >
              </sl-switch>
            </sl-tooltip>
            <div style="margin-left:24px">
              ${this.showDetails ? chevronSingleDownIcon(18) : chevronSingleUpIcon(18)}
            </div>
          </div>
          <div class="column details-container" style="${this.showDetails ? '' : 'display: none;'}">
            <div class="installer row">
              ${this.addedBy
        ? html`<agent-avatar
                    style="margin-right: 5px;"
                    .agentPubKey=${this.addedBy}
                  ></agent-avatar>`
        : html`${msg('unknown')}`}
              <span>${msg('installed this tool to the group space ')}</span>
            </div>
            <div class="participants row">
              <span style="margin-right: 5px;">${msg('In use by: ')}</span>
              ${this.renderJoinedMembers()}
            </div>

            ${this.renderAbandonedMembers()}

            <div class="row" style="${this.showAdvanced ? "display:none; " : ""} padding-top: 12px; border-top: 1px solid var(--moss-grey-light); align-items: flex-end; justify-content:space-between; ">
             

              <button
                class="moss-button"
                style="height:18px;border-radius:8px; padding: 8px 10px;border: 1px solid #89D6AA; color: #89D6AA"
                @click=${(e) => {
        e.stopPropagation();
        this.showAdvanced = !this.showAdvanced;
      }}
                >
                <div class="row items-center">
                  ${devIcon(16)}
                  <span style="margin-left: 5px;font-size: 12px; ">${msg('advanced settings')}</span>
                </div>
              </button>
    
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

              ${this.renderArchiveButton()}
            </div>
        </div>
            ${this.showAdvanced
        ? html`
                  ${this.renderMetaSettings()}
                `
        : html``}
          
        </div>
      </div>
    `;
  }

  static styles = [
    mossStyles,
    toolSettingsStyles,
    css`
      .cell-card {
        border-radius: 10px;
        padding: 8px 12px;
        margin-top: 5px;
        box-shadow: 0 0 5px 0 black;
      }
      .meta-settings {
        color: var(--moss-grey-light);
        background-color: #151A11;
        border-radius: 8px;
        padding: 10px;
        margin: 15px 0 10px 0;
      }

      .title-bar {
        background-clip: border-box;
        padding: 6px;
      }

      .title-bar:hover {
        background: #f5f5f5;
      }
    `,
  ];
}

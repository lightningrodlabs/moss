import { AgentPubKey, EntryHash, encodeHashToBase64 } from '@holochain/client';
import { hashProperty, notify, notifyError, wrapPathInSvg } from '@holochain-open-dev/elements';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { mdiArchiveArrowUpOutline } from '@mdi/js';

import '@holochain-open-dev/profiles/dist/elements/agent-avatar.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';

import '../copy-hash';
import '../../../applets/elements/applet-logo';

import { ALWAYS_ONLINE_TAG, Applet, GroupAppletsMetaData } from '@theweave/group-client';

import { StoreSubscriber, lazyLoadAndPoll } from '@holochain-open-dev/stores';
import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';
import { groupStoreContext } from '../../../groups/context.js';
import { GroupStore } from '../../../groups/group-store.js';
import { mossStyles } from '../../../shared-styles.js';
import { chevronSingleDownIcon, chevronSingleUpIcon, deprecateIcon } from '../icons';
import '../moss-mini-button.js';
import { toolSettingsStyles } from './tool-settings-styles';
import { deprecateTool, undeprecateTool } from './tool-settings-utils';

@localized()
@customElement('abandoned-applet-settings-card')
export class AbandonedAppletSettingsCard extends LitElement {
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

  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  @property()
  applet!: Applet;

  @state()
  addedBy: AgentPubKey | undefined;

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
    const appletRecord = await this.groupStore.groupClient.getPublicApplet(this.appletHash);
    if (appletRecord) {
      this.addedBy = appletRecord.action.author;
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
          <div class="participants row">
            <span>In use by: </span>
            ${this._joinedMembers.value.value.length === 0
              ? html`<span>Nobody activated this tool or everyone abandoned it.</span>`
              : this._joinedMembers.value.value.map(
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

  renderArchiveButton() {
    if (!this.canIArchive()) return html``;
    switch (this.archiveState()) {
      case 'notArchived':
        return html`
          <sl-tooltip
            content=${msg(
              'Archiving will make it not show up anymore for new members in the "Unjoined Tools" section',
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

        <div class="column flex-1">
          <div
            class="row title-bar flex-1 items-center"
            tabindex="0"
            @click=${(e) => {
              e.stopPropagation();
              this.showDetails = !this.showDetails;
            }}
            @keypress=${(e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                this.showDetails = !this.showDetails;
              }
            }}
          >
            <applet-logo
              .appletHash=${this.appletHash}
              style="margin-right: 16px; --size: 64px;"
            ></applet-logo>
            <div class="column">
              <div class="tool-name">${this.applet.custom_name}</div>
            </div>

            <span class="flex-1"></span>
            <div>${this.showDetails ? chevronSingleDownIcon(18) : chevronSingleUpIcon(18)}</div>
          </div>
          <div class="column details-container" style="${this.showDetails ? '' : 'display: none;'}">
            <div class="installer row">
              ${this.addedBy
                ? html`<agent-avatar
                    style="margin-left: 5px;"
                    .agentPubKey=${this.addedBy}
                  ></agent-avatar>`
                : html`${msg('unknown')}`}
              <span>${msg('installed this tool to the group space ')}</span>
            </div>

            ${this.renderJoinedMembers()} ${this.renderAbandonedMembers()}

            <span style="margin-bottom: 4px; margin-top: 4px;">${msg('applet hash')}:</span>
            <div class="row">
              <copy-hash .hash=${encodeHashToBase64(this.appletHash)}></copy-hash>
            </div>

            <div class="row" style="margin-top: 10px; align-items: flex-end;">
              <span class="flex flex-1"></span>
              ${this.renderArchiveButton()}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  static styles = [
    mossStyles,
    toolSettingsStyles,

    css`
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

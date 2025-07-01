import { AgentPubKey, EntryHash, encodeHashToBase64 } from '@holochain/client';
import { hashProperty, notify, notifyError, wrapPathInSvg } from '@holochain-open-dev/elements';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { mdiArchiveArrowDownOutline, mdiArchiveArrowUpOutline } from '@mdi/js';

import '@holochain-open-dev/profiles/dist/elements/agent-avatar.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';

import { ALWAYS_ONLINE_TAG, Applet, GroupAppletsMetaData } from '@theweave/group-client';
import { mossStyles } from '../../shared-styles.js';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { StoreSubscriber, lazyLoadAndPoll } from '@holochain-open-dev/stores';
import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';

@localized()
@customElement('abandoned-applet-card')
export class AbandonedAppletCard extends LitElement {
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
          <div class="row" style="align-items: center; margin-top: 4px;">
            <span><b>joined by:&nbsp;</b></span>
            ${this._joinedMembers.value.value.length === 0
              ? html`<span>Nobody joined this Tool or everyone abandoned it.</span>`
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
            <span><b>abandoned by:&nbsp;</b></span>
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
              'Unarchive this Tool for it to show up again for new membersin the "Unjoined Tools" section',
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
            <span style="flex: 1; font-size: 23px; font-weight: 600;"
              >${this.applet.custom_name}</span
            >
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

          ${this.renderJoinedMembers()} ${this.renderAbandonedMembers()}

          <div class="row" style="margin-top: 10px; align-items: flex-end;">
            <span class="flex flex-1"></span>
            ${this.renderArchiveButton()}
          </div>
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
    `,
  ];
}

import { AgentPubKey, EntryHash, encodeHashToBase64 } from '@holochain/client';
import { hashProperty, wrapPathInSvg } from '@holochain-open-dev/elements';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { property, state } from 'lit/decorators.js';
import { msg } from '@lit/localize';
import { mdiArchiveArrowUpOutline } from '@mdi/js';

import '@holochain-open-dev/profiles/dist/elements/agent-avatar.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import '../copy-hash';
import '../moss-mini-button.js';
import { deprecateIcon, devIcon } from '../icons.js';
import { deprecateTool, undeprecateTool } from './tool-settings-utils.js';

import { ALWAYS_ONLINE_TAG, Applet, GroupAppletsMetaData } from '@theweave/group-client';

import { StoreSubscriber, lazyLoadAndPoll } from '@holochain-open-dev/stores';
import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';
import { groupStoreContext } from '../../../groups/context.js';
import { GroupStore } from '../../../groups/group-store.js';
import { mossStyles } from '../../../shared-styles.js';
import { toolSettingsStyles } from './tool-settings-styles.js';

/**
 * Base class for applet settings cards.
 * Contains all shared functionality between abandoned and active applet settings cards.
 */
export abstract class BaseAppletSettingsCard extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  // Store subscribers - identical in both components
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

  // Common properties
  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  @property()
  applet!: Applet;

  @state()
  addedBy: AgentPubKey | undefined;

  @state()
  showDetails = false;

  @state()
  showAdvanced = false;

  // Lifecycle methods
  async firstUpdated() {
    const appletRecord = await this.groupStore.groupClient.getPublicApplet(this.appletHash);
    if (appletRecord) {
      this.addedBy = appletRecord.action.author;
    }
    await this.onAfterFirstUpdated();
  }

  /**
   * Override to perform component-specific initialization after common firstUpdated logic
   */
  protected async onAfterFirstUpdated(): Promise<void> {
    // Override in subclasses if needed
  }

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

  deprecateState(): 'archived' | 'notArchived' | undefined {
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

  // Common render methods - identical in both components
  renderInstallerRow() {
    return html`
      <div class="installer row">
        ${this.addedBy
        ? html`<agent-avatar
                    style="margin-right: 5px;"
                    .agentPubKey=${this.addedBy}
                  ></agent-avatar>`
        : html`${msg('unknown')}`}
        <span>${msg('installed this tool to the group space ')}</span>
      </div>
    `;
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
            <span>Uninstalled by: </span>
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

  renderDeprecateButton() {
    if (!this.canIArchive()) return html``;
    switch (this.deprecateState()) {
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

  renderAdvancedSettingsToggle() {
    return html`
      <button
        class="moss-button"
        style="height:18px;border-radius:8px; padding: 8px 10px;border: 1px solid #89D6AA; color: #89D6AA"
        @click=${(e: MouseEvent) => {
        e.stopPropagation();
        this.showAdvanced = !this.showAdvanced;
      }}
      >
        <div class="row items-center">
          ${devIcon(16)}
          <span style="margin-left: 5px;font-size: 12px; ">${msg('advanced settings')}</span>
        </div>
      </button>
    `;
  }

  // Render structure - template methods for customization
  render() {
    return html`
      <div
        class="column tool flex-1 ${this.showDetails ? 'tool-expanded' : ''}"
        style="position: relative; ${this.deprecateState() === 'archived' ? 'opacity: 0.6' : ''}"
        @click=${(e) => {
        e.stopPropagation();
        this.showDetails = !this.showDetails;
      }}
        @keypress=${(e) => {
        e.stopPropagation();
      }}
      >
        ${this.deprecateState() === 'archived'
        ? html`<span class="tool-deprecated" style="position: absolute; top: 2px; right: 2px;"
              >${msg('Deprecated')}</span
            > `
        : html``}

        <div class="column ${this.getInnerContainerClass()}" style="${this.getInnerContainerStyle()}">
          ${this.renderTitleBar()}
          ${this.renderDetailsContainer()}
        </div>
      </div>
    `;
  }

  /**
   * Override to customize inner container class
   */
  protected getInnerContainerClass(): string {
    return 'flex-1';
  }

  /**
   * Override to customize inner container style
   */
  protected getInnerContainerStyle(): string {
    return '';
  }

  /**
   * Render the title bar. Override renderTitleBarContent() to customize content.
   */
  protected renderTitleBar() {
    return html`
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
        ${this.renderTitleBarContent()}
      </div>
    `;
  }

  /**
   * Override to customize title bar content
   */
  protected abstract renderTitleBarContent(): ReturnType<typeof html>;

  /**
   * Render the details container. Common structure with installer, members, and actions.
   */
  protected renderDetailsContainer() {
    return html`
      <div class="column details-container" style="${this.showDetails ? '' : 'display: none;'}">
        ${this.renderInstallerRow()}

        ${this.renderJoinedMembers()} ${this.renderAbandonedMembers()}

        <div 
          class="row" 
          style="${this.showAdvanced ? "display:none; " : ""} padding-top: 12px; border-top: 1px solid var(--moss-grey-light); align-items: flex-end; justify-content:space-between; "
          @click=${(e: MouseEvent) => {
        e.stopPropagation();
      }}
        >
          ${this.renderDetailsActions()}
        </div>
        ${this.showAdvanced
        ? html`
            <div 
              @click=${(e: MouseEvent) => {
            e.stopPropagation();
            // Allow clicking the header to toggle advanced section
            const target = e.target as HTMLElement;
            if (target.closest('.meta-settings')) {
              this.showAdvanced = !this.showAdvanced;
            }
          }}
            >
              ${this.renderAdvancedSection()}
            </div>
          `
        : html``}
      </div>
    `;
  }

  /**
   * Override to customize action buttons row (outside advanced section)
   * Should include advanced settings toggle and other action buttons
   */
  protected abstract renderDetailsActions(): ReturnType<typeof html>;

  /**
   * Render the advanced settings section with common header and applet hash.
   * Override renderAdvancedSectionContent() to customize the content below the header.
   */
  renderAdvancedSection() {
    return html`
      <div class="column meta-settings">
        <div style="color:#89D6AA">${devIcon(16)} ${msg('Advanced Settings')}</div>
        <div class="row items-center">
          <div class="row items-center">
            <span style="margin-left:8px; margin-bottom: 4px; margin-top: 4px;">${msg('tool hash')}:</span>
            <div class="row">
              <copy-hash styles="color:#E7EEC4" .hash=${encodeHashToBase64(this.appletHash)}></copy-hash>
            </div>
          </div>
        </div>
        ${this.renderAdvancedSectionContent()}
      </div>
    `;
  }

  /**
   * Override to customize advanced settings section content (below the header and applet hash)
   */
  protected abstract renderAdvancedSectionContent(): ReturnType<typeof html>;

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

      .meta-settings {
        color: var(--moss-grey-light);
        background-color: #151A11;
        border-radius: 8px;
        padding: 10px;
        margin: 15px 0 10px 0;
        cursor: pointer;
      }
    `,
  ];
}


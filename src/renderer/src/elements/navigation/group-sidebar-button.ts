import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { StoreSubscriber, Unsubscriber } from '@holochain-open-dev/stores';
import { encodeHashToBase64 } from '@holochain/client';

import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import { groupStoreContext } from '../../groups/context.js';
import { GroupStore } from '../../groups/group-store.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import './sidebar-button.js';
import { sharedStyles } from '@holochain-open-dev/elements';
import { msg } from '@lit/localize';
import { onlineDebugLog } from '../../utils.js';

@customElement('group-sidebar-button')
export class GroupSidebarButton extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

  groupNotificationCount = new StoreSubscriber(
    this,
    () => this._groupStore.allUnreadNotifications,
    () => [this._groupStore],
  );

  @state()
  _previousOnlineAgents = 0;

  @state()
  _loadingPeerCount = false;

  private _onlinePeersCount = new StoreSubscriber(
    this,
    () => this._groupStore?.onlinePeersCount,
    () => [this._groupStore],
  );

  private _groupMemberWithProfiles = new StoreSubscriber(
    this,
    () => this._groupStore?.allProfiles,
    () => [this._groupStore],
  );
  totalMembers() {
    switch (this._groupMemberWithProfiles.value?.status) {
      case 'complete':
        return this._groupMemberWithProfiles.value.value.size;
      default:
        return 1; // self
    }
  }

  _unsubscribe: Unsubscriber | undefined;

  // Track which GroupStore the manual subscription was created for
  private _manualSubGroupStoreId: string | undefined;
  private _manualSubStoreRef: unknown | undefined;

  disconnectedCallback(): void {
    if (this._unsubscribe) this._unsubscribe();
    const groupId = this._groupStore ? encodeHashToBase64(this._groupStore.groupDnaHash).slice(0, 8) : '??';
    onlineDebugLog(`[OnlineDebug][${groupId}] group-sidebar-button disconnected`);
  }

  private _setupManualSubscription() {
    if (this._unsubscribe) this._unsubscribe();

    const groupId = this._groupStore ? encodeHashToBase64(this._groupStore.groupDnaHash).slice(0, 8) : '??';
    this._manualSubGroupStoreId = groupId;
    this._manualSubStoreRef = this._onlinePeersCount.store;

    onlineDebugLog(`[OnlineDebug][${groupId}] Setting up manual subscription, store ref exists: ${!!this._onlinePeersCount.store}`);

    if (!this._onlinePeersCount.store) return;

    this._unsubscribe = this._onlinePeersCount.store.subscribe((count) => {
      const currentGroupId = this._groupStore ? encodeHashToBase64(this._groupStore.groupDnaHash).slice(0, 8) : '??';
      const storeRefMatch = this._onlinePeersCount.store === this._manualSubStoreRef;

      const numOnlineAgents = count ?? 0;
      if (numOnlineAgents > 0) {
        if (this._previousOnlineAgents === 0) {
          onlineDebugLog(
            `[OnlineDebug][${currentGroupId}] NEW AGENTS ONLINE. ` +
            `manualSub count=${numOnlineAgents}, ` +
            `subscriberValue=${this._onlinePeersCount.value}, ` +
            `manualSubCreatedFor=${this._manualSubGroupStoreId}, ` +
            `storeRefStillMatches=${storeRefMatch}`
          );
          this.dispatchEvent(
            new CustomEvent('agents-online', {
              detail: this._groupStore.groupDnaHash,
              bubbles: true,
              composed: true,
            }),
          );
        }
      }
      this._previousOnlineAgents = numOnlineAgents;
    });
  }

  firstUpdated() {
    this._setupManualSubscription();
  }

  @property()
  logoSrc!: string;

  @property()
  tooltipText!: string;

  @property()
  placement:
    | 'top'
    | 'top-start'
    | 'top-end'
    | 'right'
    | 'right-start'
    | 'right-end'
    | 'bottom'
    | 'bottom-start'
    | 'bottom-end'
    | 'left'
    | 'left-start'
    | 'left-end' = 'right';

  @property()
  selected = false;

  @property()
  indicated = false;

  renderOnlineCount() {
    const totalPeers = this.totalMembers() - 1;
    const onlineAgentCount = this._onlinePeersCount.value;
    const groupId = this._groupStore ? encodeHashToBase64(this._groupStore.groupDnaHash).slice(0, 8) : '??';

    // Log when count is 0 but we previously had agents (potential bug indicator)
    if (onlineAgentCount === 0 && this._previousOnlineAgents > 0) {
      onlineDebugLog(
        `[OnlineDebug][${groupId}] Rendering count=0 but _previousOnlineAgents=${this._previousOnlineAgents}, ` +
        `storeSubscriber has active sub: ${!!this._onlinePeersCount['_unsubscribe']}, ` +
        `manualSubCreatedFor=${this._manualSubGroupStoreId}`
      );
    }

    return html`
      <div
        class="row center-content online-agents ${!!onlineAgentCount && onlineAgentCount > 0
          ? 'green'
          : 'gray'}"
        title="${this._loadingPeerCount
          ? msg('Loading number of online members')
          : `${onlineAgentCount}/${totalPeers} ${msg('peers online')}`}"
      >
        ${onlineAgentCount === undefined
          ? html`<sl-spinner
              style="font-size: 10px; --indicator-color: white; --track-color: var(--sl-color-primary-700)"
            ></sl-spinner>`
          : html` <span>${onlineAgentCount}</span
              ><span class="gray" style="font-weight:400">/${totalPeers}</span>`}
      </div>
    `;
  }

  render() {
    // switch notification count, if complete, show with
    switch (this.groupNotificationCount.value.status) {
      case 'error':
        return html`
          <sidebar-button
            .selected=${this.selected}
            .indicated=${this.indicated}
            .logoSrc=${this.logoSrc}
            .tooltipText=${this.tooltipText}
            .placement=${this.placement}
          ></sidebar-button>
        `;
      case 'pending':
        return html`
          <sidebar-button
            .selected=${this.selected}
            .indicated=${this.indicated}
            .logoSrc=${this.logoSrc}
            .tooltipText=${this.tooltipText}
            .placement=${this.placement}
          ></sidebar-button>
        `;
      case 'complete':
        return html`
          <sidebar-button
            .selected=${this.selected}
            .indicated=${this.indicated}
            .logoSrc=${this.logoSrc}
            .tooltipText=${this.tooltipText}
            .placement=${this.placement}
            .notificationCount=${this.groupNotificationCount.value.value[1]}
            .notificationUrgency=${this.groupNotificationCount.value.value[0]}
          ></sidebar-button>
          ${this.renderOnlineCount()}
        `;
    }
  }

  static get styles() {
    return [
      sharedStyles,
      css`
        .online-agents {
          position: absolute;
          bottom: 10px;
          left: 50%;
          transform: translateX(-50%);
          border-radius: 4px;
          padding: 2px 2px;
          align-items: center;
          background: var(--moss-dark-button);
          height: 14px;
          font-weight: 600;
          font-size: 12px;
        }

        .green {
          color: #24ee09;
        }

        .gray {
          color: #b0b0b0;
        }
      `,
    ];
  }
}

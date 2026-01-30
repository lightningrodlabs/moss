import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { StoreSubscriber, Unsubscriber } from '@holochain-open-dev/stores';

import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import { groupStoreContext } from '../../groups/context.js';
import { GroupStore } from '../../groups/group-store.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import './sidebar-button.js';
import { sharedStyles } from '@holochain-open-dev/elements';
import { msg } from '@lit/localize';
import { encodeHashToBase64 } from '@holochain/client';

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

  _peerStatuses = new StoreSubscriber(
    this,
    () => this._groupStore.peerStatuses(),
    () => [this._groupStore],
  );

  _unsubscribe: Unsubscriber | undefined;

  disconnectedCallback(): void {
    if (this._unsubscribe) this._unsubscribe();
  }

  firstUpdated() {
    this._unsubscribe = this._peerStatuses.store.subscribe((value) => {
      if (!value) {
        value = {};
      }
      const numOnlineAgents = Object.entries(value).filter(
        ([pubkey, status]) =>
          status.status === 'online' &&
          pubkey !== encodeHashToBase64(this._groupStore.groupClient.myPubKey),
      ).length;
      if (numOnlineAgents > 0) {
        if (this._previousOnlineAgents === 0) {
          console.log('NEW AGENTS ONLINE.');
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
    console.log('this._peerStatuses.value: ', this._peerStatuses.value);
    const totalAgentCount =
      this._peerStatuses.value || this._peerStatuses.value === 0
        ? Object.keys(this._peerStatuses.value).length - 1
        : undefined;
    const onlineAgentCount =
      this._peerStatuses.value || this._peerStatuses.value === 0
        ? Object.entries(this._peerStatuses.value).filter(
            ([pubkey, status]) =>
              ['online', 'inactive'].includes(status.status) &&
              pubkey !== encodeHashToBase64(this._groupStore.groupClient.myPubKey),
          ).length
        : undefined;

    // console.log('onlineAgentCount: ', onlineAgentCount);

    return html`
      <div
        class="row center-content online-agents ${!!onlineAgentCount && onlineAgentCount > 0
          ? 'green'
          : 'gray'}"
        title="${this._loadingPeerCount
          ? msg('Loading number of online members')
          : `${onlineAgentCount}/${totalAgentCount} ${msg('member(s) online')}`}"
      >
        ${onlineAgentCount === undefined
          ? html`<sl-spinner
              style="font-size: 10px; --indicator-color: white; --track-color: var(--sl-color-primary-700)"
            ></sl-spinner>`
          : html` <span>${onlineAgentCount}</span
              ><span class="gray" style="font-weight:400">/${onlineAgentCount}</span>`}
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

import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { derived, joinMap, pipe, StoreSubscriber } from '@holochain-open-dev/stores';

import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import { groupStoreContext } from '../groups/context.js';
import { GroupStore } from '../groups/group-store.js';
import { WeStore } from '../we-store.js';
import { weStoreContext } from '../context.js';
import './sidebar-button.js';
import { sharedStyles, wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiAccountMultiple } from '@mdi/js';
import { pickBy, slice } from '@holochain-open-dev/utils';
import { Status } from '@holochain-open-dev/peer-status';
import { msg } from '@lit/localize';

@customElement('group-sidebar-button')
export class GroupSidebarButton extends LitElement {
  @consume({ context: weStoreContext, subscribe: true })
  _weStore!: WeStore;

  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

  groupNotificationCount = new StoreSubscriber(
    this,
    () => this._groupStore.allUnreadNotifications,
    () => [this._groupStore],
  );

  @state()
  _loadingPeerCount = true;

  _onlineAgents = new StoreSubscriber(
    this,
    () =>
      pipe(this._groupStore.members, (members) =>
        derived(
          joinMap(slice(this._groupStore.peerStatusStore.agentsStatus, members)),
          (agentsStatus) =>
            Array.from(
              pickBy(agentsStatus, (status, _key) => status === Status.Online).keys(),
            ).filter(
              (pubKey) => pubKey.toString() !== this._groupStore.groupClient.myPubKey.toString(),
            ),
        ),
      ),
    () => [this._groupStore],
  );

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
    switch (this._onlineAgents.value.status) {
      case 'pending':
        return html``;
      case 'error':
        return html``;
      case 'complete':
        const onlineAgentCount = this._onlineAgents.value.value.length;
        setTimeout(() => {
          this._loadingPeerCount = false;
        }, 300);
        return html`
          <div
            class="row center-content online-agents ${onlineAgentCount > 0 ? 'green' : 'gray'}"
            title="${this._loadingPeerCount
              ? msg('Loading number of online members')
              : `${onlineAgentCount} ${msg('member(s) online')}`}"
          >
            ${this._loadingPeerCount
              ? html`<sl-spinner
                  style="font-size: 10px; margin-right: 5px; --indicator-color: white; --track-color: var(--sl-color-primary-700)"
                ></sl-spinner>`
              : html`
                  <sl-icon
                    .src=${wrapPathInSvg(mdiAccountMultiple)}
                    style="font-size: 20px; font-weight: bold;"
                  ></sl-icon>
                  <span>${onlineAgentCount}</span>
                `}
          </div>
        `;
    }
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
          bottom: -2px;
          right: 3px;
          border-radius: 10px;
          padding: 1px 2px;
          align-items: center;
          background: var(--sl-color-primary-900);
          min-width: 34px;
          height: 22px;
          pointer-events: none;
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

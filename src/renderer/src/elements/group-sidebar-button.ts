import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { consume } from '@lit-labs/context';
import { StoreSubscriber } from '@holochain-open-dev/stores';

import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import { groupStoreContext } from '../groups/context.js';
import { GroupStore } from '../groups/group-store.js';
import { WeStore } from '../we-store.js';
import { weStoreContext } from '../context.js';
import './sidebar-button.js';

@customElement('group-sidebar-button')
export class GroupSidebarButton extends LitElement {
  @consume({ context: weStoreContext, subscribe: true })
  _weStore!: WeStore;

  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

  // groupNotificationCount = new StoreSubscriber(
  //   this,
  //   () => asyncDerived(this._groupStore.allApplets, (allApplets) => {
  //     // derive total amount of notifications for all applets of this group
  //     const notificationCounts = { "low": 0, "medium": 0, "high": 0 }

  //     allApplets.forEach((appletHash) => {
  //       const notificationStatusApplet = get(this._weStore.notificationStatus(encodeHashToBase64(appletHash)));
  //       console.log("#### notificationStatusApplet: ", notificationStatusApplet);
  //       const urgency = notificationStatusApplet[0];
  //       const counts = notificationStatusApplet[1];
  //       if (urgency && counts) {
  //         notificationCounts[urgency] += counts;
  //       }
  //     })

  //     if (notificationCounts.high) {
  //       return ["high", notificationCounts.high];
  //     } else if (notificationCounts.medium) {
  //       return ["medium", notificationCounts.medium];
  //     } else if (notificationCounts.low) {
  //       return ["low", notificationCounts.low];
  //     }
  //     return [undefined, undefined];
  //   }),
  //   () => [this._weStore, this._groupStore]
  // );

  groupNotificationCount = new StoreSubscriber(
    this,
    () => this._groupStore.allUnreadNotifications,
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

  render() {
    // switch notification count, if complete, show with
    switch (this.groupNotificationCount.value.status) {
      case 'error':
        return html`
          <sidebar-button
            .selected=${this.selected}
            .logoSrc=${this.logoSrc}
            .tooltipText=${this.tooltipText}
            .placement=${this.placement}
          ></sidebar-button>
        `;
      case 'pending':
        return html`
          <sidebar-button
            .selected=${this.selected}
            .logoSrc=${this.logoSrc}
            .tooltipText=${this.tooltipText}
            .placement=${this.placement}
          ></sidebar-button>
        `;
      case 'complete':
        return html`
          <sidebar-button
            .selected=${this.selected}
            .logoSrc=${this.logoSrc}
            .tooltipText=${this.tooltipText}
            .placement=${this.placement}
            .notificationCount=${this.groupNotificationCount.value.value[1]}
            .notificationUrgency=${this.groupNotificationCount.value.value[0]}
          ></sidebar-button>
        `;
    }
  }
}

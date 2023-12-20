import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';

import { AppletStore } from '../applets/applet-store.js';
import '../applets/elements/applet-logo-raw.js';
import '../elements/topbar-button.js';

@customElement('applet-topbar-button')
export class AppletTopBarButton extends LitElement {
  @property()
  appletStore!: AppletStore;

  appletNotificationStatus = new StoreSubscriber(
    this,
    () => this.appletStore.unreadNotifications(),
    () => [this.appletStore],
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

  render() {
    return html`
      <topbar-button
        style="margin-left: -4px;"
        .selected=${this.selected}
        .indicated=${this.indicated}
        .tooltipText=${this.tooltipText}
        placement=${this.placement}
      >
        <applet-logo-raw
          .appletHash=${this.appletStore.appletHash}
          .notificationUrgency=${this.appletNotificationStatus.value[0]}
          .notificationCount=${this.appletNotificationStatus.value[1]}
          style="z-index: 1; --size: 58px;"
        ></applet-logo-raw>
      </topbar-button>
    `;
  }
}

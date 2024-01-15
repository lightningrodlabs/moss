import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';

import { AppletStore } from '../applets/applet-store.js';
import '../applets/elements/applet-logo-raw.js';
import '../elements/topbar-button.js';
import { mdiRefresh } from '@mdi/js';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { msg, localized } from '@lit/localize';

@localized()
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
        style="margin-left: -4px; position: relative;"
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
        <sl-tooltip
          hoist
          placement="right"
          content=${msg('Reload Applet')}
        >
          <sl-icon
            class="refresh"
            style="${this.selected ? '' : 'display: none;'}"
            tabindex="0"
            .src=${wrapPathInSvg(mdiRefresh)}
            @click=${() => {
              this.dispatchEvent(
                new CustomEvent('refresh-applet', {
                  detail: {
                    appletHash: this.appletStore.appletHash,
                  },
                  bubbles: true,
                  composed: true,
                }),
              );
            }}
            @keypress=${(e: KeyboardEvent) => {
              if (e.key === 'Enter') {
                this.dispatchEvent(
                  new CustomEvent('refresh-applet', {
                    detail: {
                      appletHash: this.appletStore.appletHash,
                    },
                    bubbles: true,
                    composed: true,
                  }),
                );
              }
            }}
          ></sl-icon>
        <sl-tooltip>
      </topbar-button>
    `;
  }

  static styles = [
    css`
      .refresh {
        position: absolute;
        bottom: 2px;
        right: 0;
        color: white;
        z-index: 1;
      }

      .refresh:hover {
        color: #90ff67;
      }
    `,
  ];
}

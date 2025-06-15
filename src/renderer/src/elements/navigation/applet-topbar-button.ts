import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';

import { AppletStore } from '../../applets/applet-store.js';
import '../../applets/elements/applet-logo-raw.js';
import './topbar-button.js';
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
          class="applet-icon ${this.selected ? 'no-shadow' : ''}"
          .toolIdentifier=${{
            type: 'instance',
            appletHash: this.appletStore.appletHash,
          }}
          .notificationUrgency=${this.appletNotificationStatus.value[0]}
          .notificationCount=${this.appletNotificationStatus.value[1]}
          style="z-index: 1; --size: 48px; --border-radius: 8px;"
        ></applet-logo-raw>
        <sl-tooltip
          hoist
          placement="right"
          content=${msg('Reload Tool')}
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
        bottom: -1px;
        right: -1px;
        color: black;
        z-index: 1;
      }

      .refresh:hover {
        color: #90ff67;
      }

      .applet-icon {
        /* box-shadow: 0 0 2px 3px var(--sl-color-primary-400); */
        box-shadow: 1px 2px 10px 0px #102520ab;
        border-radius: 8px;
      }

      /* .applet-icon:hover {
        box-shadow: none;
      } */

      /* .no-shadow {
        box-shadow: none;
      } */
    `,
  ];
}

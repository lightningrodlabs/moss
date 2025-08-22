import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { msg, localized } from '@lit/localize';
import { AppletStore } from '../../../applets/applet-store.js';

import '../../../applets/elements/applet-logo-raw.js';
import { consume } from '@lit/context';
import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';
import { mossStyles } from '../../../shared-styles.js';
import { groupStoreContext } from '../../../groups/context.js';
import { GroupStore } from '../../../groups/group-store.js';

@localized()
@customElement('applet-sidebar-button')
export class AppletSidebarButton extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  @property({ type: Boolean })
  collapsed = false;

  @property()
  selected = false;

  @property()
  appletStore!: AppletStore;

  @property()
  logoSrc!: string;

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
  indicated = false;

  appletLogo = new StoreSubscriber(
    this,
    () => this.mossStore.appletLogo.get(this.appletStore.appletHash),
    () => [this.appletStore],
  );

  appletNotificationStatus = new StoreSubscriber(
    this,
    () => this.appletStore.unreadNotifications(),
    () => [this.appletStore],
  );

  notificationUrgency(): string | undefined {
    return this.appletNotificationStatus.value[0];
  }

  notificationCount(): number | undefined {
    return this.appletNotificationStatus.value[1];
  }

  renderLogo() {
    switch (this.appletLogo.value.status) {
      case 'pending':
        return html`<sl-skeleton
          style="--color: #9d90f7; height: var(--size, ${this.collapsed
            ? '35px'
            : '28px'}); width: var(--size, ${this.collapsed
            ? '35px'
            : '28px'}); --border-radius: 8px"
          effect="pulse"
        ></sl-skeleton> `;
      case 'complete':
        return html`
          ${this.appletLogo.value.value
            ? html`<img
                class="icon ${this.collapsed ? 'large' : ''}"
                .src=${this.appletLogo.value.value}
                alt=${`${this.appletStore.applet.custom_name} Tool icon`}
              />`
            : html`<div class="column center-content icon" style="background: #9d90f7;">?</div>`}
        `;
      case 'error':
        console.error('Failed to fetch applet icon: ', this.appletLogo.value.error);
        return html`<display-error
          tooltip
          .headline=${msg('Error fetching the applet logo')}
          .error=${this.appletLogo.value.error}
        ></display-error>`;
    }
  }

  render() {
    return html`
      <div class="column flex-1">
        <button
          class="btn ${this.selected ? 'selected' : ''}"
          style="${this.collapsed ? 'margin: 1px 0;' : ''}"
        >
          <div class="row items-center">
            <div class="row items-center">${this.renderLogo()}</div>
            ${this.collapsed
              ? html``
              : html` <div class="name" style="margin-left: 4px;">
                  ${this.appletStore.applet.custom_name}
                </div>`}
          </div>
        </button>
        ${this.notificationUrgency() === 'low' || !this.notificationUrgency()
          ? html``
          : html`
              <div
                class="row center-content notification-dot ${this.notificationUrgency() === 'high'
                  ? 'urgent'
                  : ''}"
              >
                ${this.notificationCount() && this.notificationUrgency() === 'high'
                  ? this.notificationCount()
                  : ''}
              </div>
            `}
      </div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        font-size: 16px;
      }

      .btn {
        all: unset;
        padding: 4px;
        border-radius: 12px;
        margin: 2px 0;
        cursor: pointer;
        position: relative;
      }

      .btn:hover:not(.selected) {
        background: #ffffff84;
      }

      .btn:focus-visible {
        border: 2px solid var(--moss-purple);
        padding: 2px;
      }

      .icon {
        height: 28px;
        width: 28px;
        border-radius: 8px;
      }

      .name {
        white-space: nowrap; /* Prevents text from wrapping to the next line */
        overflow: hidden; /* Hides overflowed text */
        text-overflow: ellipsis; /* Adds ellipsis (...) for overflowed text */
      }

      .large {
        height: 35px;
        width: 35px;
      }

      .selected {
        background: white;
      }

      .notification-dot {
        position: absolute;
        top: -2px;
        right: -2px;
        font-weight: bold;
        background: var(--moss-purple);
        border-radius: 10px;
        height: 10px;
        min-width: 10px;
      }

      .urgent {
        height: 16px;
        min-width: 18px;
        border-radius: 4px;
        color: white;
        font-size: 12px;
        padding: 0 3px;
      }
    `,
  ];
}

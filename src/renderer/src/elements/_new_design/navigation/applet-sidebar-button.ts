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
  notificationCount: number | undefined;

  @property()
  notificationUrgency: 'low' | 'medium' | 'high' | undefined;

  @property()
  appletStore!: AppletStore;

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

  renderLogo() {
    switch (this.appletLogo.value.status) {
      case 'pending':
        return html`<sl-skeleton
          style="height: var(--size, ${this.collapsed ? '35px' : '28px'}); width: var(--size, ${this
            .collapsed
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
            : html`<div class="column center-content icon" style="background: gray;">?</div>`}
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
        <button class="btn ${this.selected ? 'selected' : ''}">
          <div class="row items-center">
            <div class="row items-center">${this.renderLogo()}</div>
            ${this.collapsed
              ? html``
              : html` <div class="name" style="margin-left: 4px;">
                  ${this.appletStore.applet.custom_name}
                </div>`}
          </div>
        </button>
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
      }

      .btn:hover:not(.selected) {
        background: #ffffff84;
      }

      .btn:focus-visible {
        outline: 2px solid var(--moss-purple);
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
    `,
  ];
}

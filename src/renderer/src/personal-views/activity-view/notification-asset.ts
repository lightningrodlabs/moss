import { pipe, StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { html, LitElement, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { localized } from '@lit/localize';
import type { FrameNotification } from '@theweave/api';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

import '../../applets/elements/applet-logo.js';
import '../../applets/elements/applet-title.js';
import '../../elements/dialogs/loading-dialog.js';
import { mossStoreContext } from '../../context.js';
import { consume } from '@lit/context';
import { MossStore } from '../../moss-store.js';
import { AppletHash } from '@theweave/api';
import { msg } from '@lit/localize';
import { formatDistanceToNow } from 'date-fns';
import { AppletNotification } from '../../types.js';
import { weStyles } from '../../shared-styles.js';

@localized()
@customElement('notification-asset')
export class NotificationAsset extends LitElement {
  @consume({ context: mossStoreContext })
  @state()
  _mossStore!: MossStore;

  @property()
  notifications!: AppletNotification[];

  @property()
  appletHash!: AppletHash;

  @property()
  notification: FrameNotification | undefined;

  _groupProfiles = new StoreSubscriber(
    this,
    () =>
      pipe(this._mossStore.groupsForApplet.get(this.appletHash), async (groupStoreMap) => {
        const groupProfiles = await Promise.all(
          Array.from(groupStoreMap.values()).map(async (groupStore) =>
            toPromise(groupStore.groupProfile),
          ),
        );
        return groupProfiles;
      }),
    () => [this.appletHash, this._mossStore],
  );

  appletLogo = new StoreSubscriber(
    this,
    () => this._mossStore.appletLogo.get(this.appletHash),
    () => [this.appletHash],
  );

  appletName = new StoreSubscriber(
    this,
    () =>
      pipe(this._mossStore.appletStores.get(this.appletHash), (appletStore) => {
        if (appletStore) {
          return appletStore.applet.custom_name;
        }
        return undefined;
      }),
    () => [this.appletHash],
  );

  renderLogo(logo: string | undefined) {
    if (!logo) return html``;

    return html`
      <img
        style="height: 14px; width: 14px; margin-bottom: -2px; margin-right: 3px;"
        title="${this.getAppletName()}"
        .src=${logo}
        alt="TODO"
      />
    `;
  }

  renderAppletLogo() {
    switch (this.appletLogo.value.status) {
      case 'pending':
        return html`<sl-skeleton style="height: 14px; width: 14px;" effect="pulse"></sl-skeleton> `;
      case 'complete':
        return this.renderLogo(this.appletLogo.value.value);
      case 'error':
        console.error('Failed to fetch applet icon: ', this.appletLogo.value.error);
        return html`<display-error
          tooltip
          .headline=${msg('Error fetching the applet logo')}
          .error=${this.appletLogo.value.error}
        ></display-error>`;
    }
  }
  // renderAppletLogo() {
  //   return html`${JSON.stringify(this.appletLogo.value)}`;
  // }

  getAppletName() {
    switch (this.appletName.value.status) {
      case 'pending':
        return 'Loading...';
      case 'complete':
        return this.appletName.value.value;
      case 'error':
        return 'Failed to load applet name';
    }
  }

  renderFirstGroupProfileIcon() {
    switch (this._groupProfiles.value.status) {
      case 'pending':
        return html`loading...`;
      case 'complete':
        const groupProfile = this._groupProfiles.value.value[0];
        return html`
          <img
            slot="prefix"
            .src=${groupProfile?.icon_src}
            alt="${groupProfile?.name}"
            title="${groupProfile?.name}"
            style="height: 16px; width: 16px; margin-bottom: -2px; margin-right: 3px;"
          />
        `;
      case 'error':
        return html`error`;
    }
  }

  render() {
    switch (this.appletLogo.value.status) {
      case 'pending':
        return html``;
      case 'complete':
        return html` <div
          class="column notification-card"
          @click=${() => {
            this.dispatchEvent(
              new CustomEvent('open-applet-main', {
                detail: this.appletHash,
                bubbles: true,
                composed: true,
              }),
            );
          }}
        >
          <div class="row notification-title">
            ${this.notification?.title}
            <span style="display: flex; flex: 1;"></span>
            ${this.renderFirstGroupProfileIcon()} ${this.renderAppletLogo()}
          </div>
          <div>${this.notification?.body}</div>
          <div class="notification-date">
            ${this.notification
              ? formatDistanceToNow(new Date(this.notification?.timestamp), { addSuffix: true })
              : 'unknown date'}
          </div>
        </div>`;

      case 'error':
        console.error(`Failed to get applet logo: ${this.appletLogo.value.error}`);
        return html`[Unknown]`;
    }
  }

  static styles = [
    weStyles,
    css`
      .activity-asset-outer {
        display: flex;
        flex-direction: column;
      }

      .show-notifications-button,
      .hide-notifications-button {
        background: #3b922d;
        background: transparent;
        color: white;
        border: none;
        border-radius: 0 0 5px 5px;
        padding: 0 0 3px 0;
        color: transparent;
        cursor: pointer;
        margin-top: -18px;
        font-size: 14px;
      }

      .show-notifications-button:hover,
      .hide-notifications-button:hover {
        background: #29711d;
      }

      .hide-notifications-button {
        border-radius: 0;
        background: #3b922d;
        color: white;
        padding: 3px 0 0 0;
      }

      .asset-title {
        font-size: 20px;
      }

      .notification-card {
        padding: 10px;
        margin-bottom: 10px;
        border-radius: 5px;
        background: #193423;
        color: #fff;
        flex: 1;
      }
      .notification-card:hover {
        background-color: #3f6733;
        cursor: pointer;
      }
      .notification-title {
        font-weight: bold;
        color: #fff;
        flex: 1;
      }
      .notification-date {
        font-size: 0.9em;
        color: #fff;
      }
      .notification-content {
        font-size: 1em;
        color: #fff;
      }
    `,
  ];
}

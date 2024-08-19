import { pipe, completed, StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { html, LitElement, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { localized } from '@lit/localize';
import type { AppletId, AssetInfo, FrameNotification } from '@lightningrodlabs/we-applet';
import { deStringifyWal } from '../../utils.js';
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
import { AppletHash } from '@lightningrodlabs/we-applet';
import { msg } from '@lit/localize';
import { ifDefined } from 'lit/directives/if-defined.js';
import { formatDistanceToNow } from 'date-fns';

@localized()
@customElement('notification-asset')
export class NotificationAsset extends LitElement {
  @consume({ context: mossStoreContext })
  
  @state()
  _mossStore!: MossStore;
  
  @property()
  notifications: any;

  @property()
  appletHash: AppletHash | undefined;

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
    () =>
      pipe(this._mossStore.appletStores.get(this.appletHash), (appletStore) => {
        console.log('Applet store logo:', appletStore.logo);
        return appletStore ? appletStore.logo : completed(undefined)
      }),
    () => [this.appletHash],
  );

  appletName = new StoreSubscriber(
    this,
    () =>
      pipe(this._mossStore.appletStores.get(this.appletHash), (appletStore) => {
        if (appletStore) {
          return appletStore.applet.custom_name;
        }
        return completed(undefined);
      }),
    () => [this.appletHash],
  );

  renderLogo(logo: string | undefined) {
    if (!logo) return html``;

    return html`
      <img
        style="height: 14px; width: 14px; margin-bottom: -3px; margin-right: 3px;"
        .src=${logo}
          alt="TODO"
        />
    `;
  }

  renderAppletLogo() {
    switch (this.appletLogo.value.status) {
      case 'pending':
        return html`<sl-skeleton
          style="height: 14px; width: 14px;"
          effect="pulse"
        ></sl-skeleton> `;
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

  renderAppletName() {
    switch (this.appletName.value.status) {
      case 'pending':
        return html`<div>Loading...</div>`;
      case 'complete':
        return html`${this.appletName.value.value}`;
      case 'error':
        return html`<div>Failed to load applet name</div>`;
    }
  }

  renderFirstGroupProfileIcon() {
    switch (this._groupProfiles.value.status) {
      case 'pending':
        return html`pending`;
      case 'complete':
        const groupProfile = this._groupProfiles.value.value[0];
        return html`
          <img
              slot="prefix"
              .src=${groupProfile?.icon_src}
              alt="${groupProfile?.name}"
              style="height: 16px; width: 16px; margin-bottom: -3px; margin-right: 3px;"
            />${groupProfile?.name}</sl-option
          >
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
          return html`
            <div class="notification-card"
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
            <div class="notification-title">${this.notification?.title}</div>
            <div style="display: flex; flex-direction: row;">
              <div style="margin-right: 10px;">
                ${this.renderFirstGroupProfileIcon()}
              </div>
              ${this.renderAppletLogo()}
              ${this.renderAppletName()}
            </div>
            <div class="notification-body">${this.notification?.body}</div>
            <div class="notification-date">
              ${this.notification ? 
                formatDistanceToNow(
                  new Date(
                    this.notification?.timestamp
                  ),
                  { addSuffix: true }
                )
                 : "unknown date"
              }
            </div>
          </div>`;

        case 'error':
          console.error(
            `Failed to get asset info for WAL '${this.wal}': ${this.assetInfo.value.error}`,
          );
          return html`[Unknown]`;
    }
  }
  
  static styles = [
    css`
    .activity-asset-outer {
      display: flex;
      flex-direction: column;
    }

    .show-notifications-button, .hide-notifications-button {
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

    .show-notifications-button:hover, .hide-notifications-button:hover {
      background: #29711d !important;
    }

    .hide-notifications-button {
      border-radius: 0;
      background: #3b922d;
      color: white;
      padding: 3px 0 0 0;
    }

    .activity-asset-outer:hover > button {
      background: #3b922d;
      color: white;
    }

    .activity-asset {
      background: white; 
      border-radius: 5px;
      padding: 10px; 
      background: #53d43f; 
      color: #3a622d; 
      max-width: calc(60vw - 110px);
      display: flex;
    }

    .activity-asset:hover {
        cursor: pointer;
        background: #4bbe39;
    }

    .asset-title {
      font-size: 20px !important;
    }

    .displayed-notifications-list {
      background: #0080574a;
      color: #c2f2c1;
      padding-bottom: 4px;
      margin-top: -9px;
      margin-bottom: 10px;
      border-radius: 0 0 5px 5px;
      max-height: 1000px;
      overflow-y: auto;
    }

    .displayed-notifications-list > div:first-child {
      margin-top: 4px;
    }

    .notification-card {
        padding: 10px;
        margin-bottom: 10px;
        border-radius: 5px;
        background-color: #3a622d;
        color: #53d43f;
      }
    .notification-card:hover {
      background-color: #3f6733;
      cursor: pointer;
    }
    .notification-title {
      font-weight: bold;
      color: #53d43f;
    }
    .notification-date {
      font-size: 0.9em;
      color: #53d43f;
    }
    .notification-content {
      font-size: 1em;
      color: #53d43f;
    }
  `,
  ];
}
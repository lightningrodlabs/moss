import { pipe, completed, StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { html, LitElement, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { localized } from '@lit/localize';
import { deStringifyWal, encodeAndStringify } from '../../utils.js';
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
import { formatDistanceToNow } from 'date-fns';
import { AppletNotification } from '../../types.js';

@localized()
@customElement('activity-asset')
export class ActivityAsset extends LitElement {
  @consume({ context: mossStoreContext })
  @state()
  _mossStore!: MossStore;

  @property({ type: Boolean })
  showNotifications = false;

  @property()
  notifications!: AppletNotification[];

  @property()
  wal!: string;

  @property()
  appletHash!: AppletHash;

  assetInfo = new StoreSubscriber(
    this,
    () => this._mossStore.assetInfo.get(this.wal),
    () => [this.wal],
  );

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
        return appletStore ? appletStore.logo : completed(undefined);
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
        return this.renderLogo(this.appletLogo.value.value)
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
        return `<div>Loading...</div>`;
      case 'complete':
        return this.appletName.value.value;
      case 'error':
        return `<div>Failed to load applet name</div>`;
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
          >
        `;
      case 'error':
        return html`error`;
    }
  }

  render() {
    switch (this.assetInfo.value.status) {
      case 'pending':
        return html``;
      case 'complete':
        return html`
            <div style="display: flex; flex-direction: column; margin-bottom: 4px;">
              <div class="activity-asset-outer">
                <div
                  @click=${() => {
                    console.log('Clicked on asset', this.wal);
                    this.dispatchEvent(
                      new CustomEvent('open-wal', {
                        detail: deStringifyWal(this.wal),
                        bubbles: true,
                        composed: true,
                      }),
                    );
                  }}
                  class="activity-asset">
                  <div
                    style="display: flex; align-items: center; margin-right: 10px;"
                  >
                    <sl-icon
                      .src=${this.assetInfo.value.value!.icon_src}
                      style="display: flex; margin-top: 2px; margin-right: 4px; font-size: 50px;"
                    ></sl-icon>
                  </div>
                  <div style="display: flex; flex-direction: column; margin-right: 10px;">
                    <div class="asset-title">
                      ${this.assetInfo?.value?.value?.name}
                      ${this.renderFirstGroupProfileIcon()}
                      ${this.renderAppletLogo()}
                    </div>
                    <div style="display: flex; flex-direction: row;">
                      <div
                        style="flex: 0 0 auto;"
                      >
                        ${this.notifications.length} notifications
                      </div>
                      <div
                        style="margin-left: 10px; flex: 0 0 auto;"
                      >
                        ${
                          new Set(
                            this.notifications
                              .filter((notification) => notification.notification.fromAgent)
                              .map((notification) =>
                                encodeAndStringify(notification.notification.fromAgent),
                              ),
                          ).size
                        } people
                      </div>
                      <div
                        style="margin-left: 10px; flex: 0 0 auto;"
                      >
                        ${formatDistanceToNow(
                          new Date(
                            this.notifications.reduce((latest, current) => {
                              return current.notification.timestamp > latest.notification.timestamp
                                ? current
                                : latest;
                            }).notification.timestamp,
                          ),
                          { addSuffix: true },
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                ${
                  this.showNotifications
                    ? html`
                        <button
                          @click=${() => {
                            this.showNotifications = false;
                          }}
                          class="hide-notifications-button"
                        >
                          ⌃
                        </button>
                      `
                    : html`
                        <button
                          @click=${() => {
                            this.showNotifications = true;
                          }}
                          class="show-notifications-button"
                        >
                          ⌄
                        </button>
                      `
                }
              </div>
              </div>
              <div class="displayed-notifications-list">
                ${
                  this.showNotifications
                    ? html`
                        ${this.notifications.map((notification: any) => {
                          return html`
                            <div style="padding: 4px 4px 0 4px">
                              ${notification.notification.title}
                            </div>
                          `;
                        })}
                      `
                    : ''
                }
              </div>
            </div>
        `;
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

      .show-notifications-button,
      .hide-notifications-button {
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
        background: #3f6733 !important;
      }

      .hide-notifications-button {
        border-radius: 0;
        background: #204d31;
        color: white;
        padding: 3px 0 0 0;
      }

      .activity-asset-outer:hover > button {
        background: #193423;
        color: white;
      }

      .activity-asset {
        background: white;
        border-radius: 5px;
        padding: 10px;
        background: #193423;
        color: #fff;
        min-width: 416px;
        max-width: calc(60vw - 110px);
        display: flex;
      }

      .activity-asset:hover {
        cursor: pointer;
        background: #3f6733;
      }

      .asset-title {
        font-size: 20px !important;
        margin: 4px 0;
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
    `,
  ];
}

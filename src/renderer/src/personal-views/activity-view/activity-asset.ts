import { pipe, completed, StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { html, LitElement, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { localized } from '@lit/localize';
import type { AssetInfo } from '@lightningrodlabs/we-applet';
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
@customElement('activity-asset')
export class ActivityAsset extends LitElement {
  @consume({ context: mossStoreContext })
  
  @state()
  _mossStore!: MossStore;

  @property({ type: Boolean })
  showNotifications = false;
  
  @property()
  notifications: any;
  
  @property()
  wal: any;

  @property()
  appletHash: AppletHash | undefined;

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
        style="height: 14px; width: 14px;"
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
              style="height: 16px; width: 16px"
            />${groupProfile?.name}</sl-option
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
            <div style="display: flex; flex-direction: column; margin-bottom: 10px;">
              <div style="display: flex; flex-direction: row;">
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
                        .src=${this.assetInfo.value.value.icon_src}
                        style="display: flex; margin-top: 2px; margin-right: 4px; font-size: 30px;"
                      ></sl-icon>
                    </div>
                    <div style="display: flex; flex-direction: column;">
                      <div style="display: flex; flex-direction: row">
                        ${this.renderFirstGroupProfileIcon()}
                        ${this.renderAppletLogo()}
                        ${this.renderAppletName()}
                      </div>
                      <div class="asset-title">
                        ${this.assetInfo?.value?.value?.name}
                      </div>
                    </div>
                    <div>
                      |
                      N: ${this.notifications.length}
                      A: ${new Set(
                        this.notifications.map((notification) => notification.agentId),
                      ).size}
                      T: ${
                        formatDistanceToNow(
                          new Date(
                            this.notifications.reduce((latest, current) => {
                              return current.notification.timestamp > latest.notification.timestamp ? current : latest;
                            }).notification.timestamp
                          ),
                          { addSuffix: true }
                        )
                      }
                    </div>
                  </div>
                  <button
                  @click=${() => {
                    this.showNotifications = !this.showNotifications;
                  }}
                  style="background: #4bbe39; color: white; border: none; border-radius: 5px; padding: 5px; margin-left: 10px;"
                  >${this.showNotifications ? `Hide` : `Show`} activity</button>
                </div>
                <div>
                  ${this.showNotifications
                    ? html`
                        ${this.notifications.map((notification: any) => {
                          return html`
                            <div style="display: flex; align-items: center; margin-top: 2px;">
                              <sl-icon
                                .src=${ifDefined(notification.notification.icon_src)}
                                style="margin-right: 4px; font-size: 12px;"
                              ></sl-icon>
                              ${notification.notification.title}
                            </div>
                          `;
                        })}
                      `
                    : ''}
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
    .activity-asset {
        background: white; 
        border-radius: 5px; 
        padding: 10px; 
        background: #53d43f; 
        color: #3a622d; 
        width: calc(100vw - 221px);
        display: flex;
    }

    .activity-asset:hover {
        cursor: pointer;
        background: #4bbe39;
    }

    .asset-title {
      font-size: 20px !important;
    }
    `,
  ];
}
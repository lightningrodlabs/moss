import { StoreSubscriber } from '@holochain-open-dev/stores';
import { html, LitElement, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { localized } from '@lit/localize';
import type { AssetInfo } from '@lightningrodlabs/we-applet';

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

@localized()
@customElement('activity-asset')
export class ActivityAsset extends LitElement {
  @consume({ context: mossStoreContext })
  
  @state()
  _mossStore!: MossStore;
  
  @property()
  notifications: any;
  
  @property()
  wal: any;

  assetInfo = new StoreSubscriber(
    this,
    () => this._mossStore.assetInfo.get(this.wal),
    () => [this.wal],
  );

  renderName(info: AssetInfo | undefined) {
    if (!info) return html`[Unknown]`;

    return html`
      <div class="row" style="align-items: center;">
        <div>
          <sl-icon
            .src=${info.icon_src}
            style="display: flex; margin-top: 2px; margin-right: 4px; font-size: 20px;"
          ></sl-icon>
        </div>
        <div
          class="column"
          title="${info.name}"
          style="color: black; overflow: hidden; height: 26px; max-width: 145px; margin-top: 10px;"
        >
          ${info.name}
        </div>
      </div>
    `;
  }
  
  render() {
    // switch (this.assetInfo.value.status) {
    //     case 'pending':
    //       return html``;
    //     case 'complete':
    //       return this.renderName(this.assetInfo.value.value);
    //     case 'error':
    //       console.error(
    //         `Failed to get asset info for WAL '${this.wal}': ${this.assetInfo.value.error}`,
    //       );
    //       return html`[Unknown]`;
    // }
    return html`
        <div 
            @click=${() => {
                console.log('Clicked on asset', this.wal);
            }}
            class="activity-asset">
            This is a placeholder title
            ${this.notifications.length}
            <div>
                ${this.notifications.map((notification: any) => {
                    return html`
                        <div
                            <sl-icon
                                .src=${notification.notification.icon_src}
                                style="display: flex; margin-top: 2px; margin-right: 4px; font-size: 12px;"
                            ></sl-icon>
                            ${notification.notification.title}
                        </div>
                    `
                })}
            </div>
        </div>
    `;
  }
  
  static styles = [
    css`
    .activity-asset {
        background: white; 
        margin-bottom: 10px; 
        border-radius: 5px; 
        padding: 10px; 
        background: #53d43f; 
        color: #3a622d; 
        width: calc(100vw - 221px);
    }

    .activity-asset:hover {
        cursor: pointer;
        background: #4bbe39;
    }
    `,
  ];
}
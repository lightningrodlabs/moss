import { html, LitElement, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

import { weStyles } from '../../shared-styles.js';
import '../../applets/elements/applet-logo.js';
import '../../applets/elements/applet-title.js';
import '../../elements/dialogs/loading-dialog.js';
import './activity-asset.js';
import { mossStoreContext } from '../../context.js';
import { consume } from '@lit/context';
import { MossStore } from '../../moss-store.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import TimeAgo from 'javascript-time-ago';
import { stringifyWal } from '../../utils.js';

@localized()
@customElement('activity-view')
export class ActivityView extends LitElement {
  @consume({ context: mossStoreContext })
  
  @state()
  _mossStore!: MossStore;

  @state()
  notificationsLoading = true;

  availableToolUpdates = new StoreSubscriber(
    this,
    () => this._mossStore.availableToolUpdates(),
    () => [this._mossStore],
  );

  timeAgo = new TimeAgo('en-US');

  @state()
  sortMethod = 'popular';

  _notificationFeed = new StoreSubscriber(
    this,
    () => this._mossStore.notificationFeed(),
    () => [this._mossStore],
  );

  // function that combines notifications based on their aboutWal, if available
  combineNotifications(notifications: Array<any>) {
    const combinedNotifications = {};
    for (let i = 0; i < notifications.length; i++) {
      const notification = notifications[i];
      if (notification.notification.aboutWal) {
        console.log('Notification with aboutWal: ', stringifyWal(notification.notification.aboutWal), notification.notification.aboutWal);
        const aboutWalUrl = stringifyWal(notification.notification.aboutWal);
        if (combinedNotifications[aboutWalUrl]) {
          combinedNotifications[aboutWalUrl].notifications.push(notification);
        } else {
          let res = this._mossStore.assetInfo.get(stringifyWal(notification.notification.aboutWal))
          console.log('Asset Info: ', res);
          combinedNotifications[aboutWalUrl] = { 
            notifications: [notification], 
          };
        }
      } else {
        console.log('Notification without aboutWal: ', notification);
      }
    }
    console.log('Combined Notifications: ', combinedNotifications);
    return combinedNotifications;
  }

  sortNotifications(combinedNotifications: any) {
    switch (this.sortMethod) {
      case 'active':
        return Object.keys(combinedNotifications).sort((a, b) => {
          return combinedNotifications[b].notifications.length - combinedNotifications[a].notifications.length;
        });
      case 'latest':
        return Object.keys(combinedNotifications).sort((a, b) => {
          return combinedNotifications[b].notifications[0].notification.timestamp - combinedNotifications[a].notifications[0].notification.timestamp;
        });
      case 'popular':
        return Object.keys(combinedNotifications).sort((a, b) => {
          return combinedNotifications[b].notifications.length - combinedNotifications[a].notifications.length;
        });
    }
  }

  getButtonStyle(method) {
    return this.sortMethod === method ? 'background-color: #53d43f;' : 'background-color: #3a622d;';
  }

  render() {
    const combinedNotifications = this.combineNotifications(this._notificationFeed.value);
    const sortedNotifications = this.sortNotifications(combinedNotifications);
    return html`
    <div class="column">
      <div class="sort-buttons">
        <button 
          @click=${() => this.sortMethod = 'popular'} 
          style=${this.getButtonStyle('popular')}
        >Popular</button>
        <button 
          @click=${() => this.sortMethod = 'active'} 
          style=${this.getButtonStyle('active')}
        >Active</button>
        <button 
          @click=${() => this.sortMethod = 'latest'} 
          style=${this.getButtonStyle('latest')}
        >Latest</button>
      </div>
      ${sortedNotifications.length === 0 ? html`
        <div style="background: white; border-radius: 10px; background: transparent; color: #468c2f; width: calc(100vw - 221px);">
          Your notifications will appear here
        </div>
      ` : sortedNotifications.map((key) => {
        const notifications = combinedNotifications[key].notifications;
        return html`
          <activity-asset .notifications=${notifications} .wal=${key}></activity-asset>
        `;
      })}
    </div>`;
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex: 1;
        background-color: #224b21;
        border-radius: 5px 0 0 0;
      }
      .column {
        padding: 10px;

      .sort-buttons {
        margin-bottom: 10px;
      }
      .sort-buttons button {
        margin-right: 5px;
        padding: 5px 10px;
        border-radius: 5px;
        background-color: #3a622d;
        color: white;
        border: none;
        cursor: pointer;
      }
      .sort-buttons button:hover {
        background-color: #53d43f;
      }
    `,
    weStyles,
  ];
}

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
import { stringifyWal, appIdFromAppletId, appletHashFromAppId } from '../../utils.js';
import { AppletHash } from '@lightningrodlabs/we-applet';
import { app } from 'electron';

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
        const aboutWalUrl = stringifyWal(notification.notification.aboutWal);
        if (combinedNotifications[aboutWalUrl]) {
          combinedNotifications[aboutWalUrl].notifications.push(notification);
        } else {
          combinedNotifications[aboutWalUrl] = {
            notifications: [notification],
            appletId: notification.appletId,
          };
        }
      }
    }
    return combinedNotifications;
  }

  sortNotifications(combinedNotifications: any) {
    switch (this.sortMethod) {
      case 'active':
        function calculateActiveScore(timestamp: number): number {
          const now = Date.now();
          const hoursPast = (now - timestamp) / 3600000; // Convert milliseconds to hours
          let score = 10;
          let timePoints = 1;
        
          for (let i = 1; i <= hoursPast; i++) {
            score -= timePoints;
            timePoints = Math.max(0, timePoints - 0.1); // Ensure timePoints doesn't go below 0
          }
        
          return score;
        }
        
        return Object.keys(combinedNotifications).sort((a, b) => {
          let scoreA = combinedNotifications[a].notifications.reduce((total, notification) => {
            return total + calculateActiveScore(notification.notification.timestamp);
          }, 0);
        
          let scoreB = combinedNotifications[b].notifications.reduce((total, notification) => {
            return total + calculateActiveScore(notification.notification.timestamp);
          }, 0);
        
          return scoreB - scoreA;
        });
      case 'latest':
        return Object.keys(combinedNotifications).sort((a, b) => {
          let latestNotificationA = combinedNotifications[a].notifications.reduce((latest, current) => {
            return current.notification.timestamp > latest.notification.timestamp ? current : latest;
          });
          
          let latestNotificationB = combinedNotifications[b].notifications.reduce((latest, current) => {
            return current.notification.timestamp > latest.notification.timestamp ? current : latest;
          });
          return latestNotificationB.notification.timestamp - latestNotificationA.notification.timestamp;
        });
      case 'popular':
        function calculatePopularScore(timestamp: number): number {
          const now = Date.now();
          const hoursPast = (now - timestamp) / 3600000; // Convert milliseconds to hours
          let score = 10;
          let timePoints = 1;
        
          for (let i = 1; i <= hoursPast; i++) {
            score -= timePoints;
            timePoints = Math.max(0, timePoints - 0.1); // Ensure timePoints doesn't go below 0
          }
        
          return score;
        }
        return Object.keys(combinedNotifications).sort((a, b) => {
          let numberOfAgentsCountA = new Set(
            combinedNotifications[a].notifications.map((notification) => notification.agentId),
          ).size;
          let numberOfAgentsCountB = new Set(
            combinedNotifications[b].notifications.map((notification) => notification.agentId),
          ).size;
          console.log('Number of Agents Count A: ', numberOfAgentsCountA, numberOfAgentsCountB);
          return numberOfAgentsCountB - numberOfAgentsCountA;
        });
      default:
        return [];
    }
  }

  getButtonStyle(method) {
    return this.sortMethod === method ? 'background-color: #53d43f;' : 'background-color: #3a622d;';
  }

  render() {
    const combinedNotifications = this.combineNotifications(this._notificationFeed.value);
    const sortedNotifications = this.sortNotifications(combinedNotifications);
    return html` <div class="column">
      <div class="sort-buttons">
        <button
          @click=${() => (this.sortMethod = 'popular')}
          style=${this.getButtonStyle('popular')}
        >
          Popular
        </button>
        <button @click=${() => (this.sortMethod = 'active')} style=${this.getButtonStyle('active')}>
          Active
        </button>
        <button @click=${() => (this.sortMethod = 'latest')} style=${this.getButtonStyle('latest')}>
          Latest
        </button>
      </div>
      ${sortedNotifications.length === 0
        ? html`
            <div
              style="background: white; border-radius: 10px; background: transparent; color: #468c2f; width: calc(100vw - 221px);"
            >
              Your notifications will appear here
            </div>
          `
        : sortedNotifications.map((key) => {
            const notifications = combinedNotifications[key].notifications;
            console.log("going to try to get appletHash for ", combinedNotifications[key].appletId);
            const appletHash: AppletHash = appletHashFromAppId(appIdFromAppletId(combinedNotifications[key].appletId));
            console.log("appletHash is ", appletHash);
            return html`
              <activity-asset 
              @open-wal=${async (e) => {
                console.log('Clicked on asset 2', e.detail);
                this.dispatchEvent(
                  new CustomEvent('open-wal', {
                    detail: e.detail,
                    bubbles: true,
                    composed: true,
                  }),
                );
              }}
              .notifications=${notifications} .wal=${key} .appletHash=${appletHash}></activity-asset>
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

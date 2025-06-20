import { html, LitElement, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

import { mossStyles } from '../../shared-styles.js';
import '../../applets/elements/applet-logo.js';
import '../../applets/elements/applet-title.js';
import '../../elements/dialogs/loading-dialog.js';
import './activity-asset.js';
import './notification-asset.js';
import { mossStoreContext } from '../../context.js';
import { consume } from '@lit/context';
import { MossStore } from '../../moss-store.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import TimeAgo from 'javascript-time-ago';
import { encodeAndStringify } from '../../utils.js';
import { AppletHash, AppletId, stringifyWal } from '@theweave/api';
import { AppletNotification } from '../../types.js';
import { appIdFromAppletId, appletHashFromAppId } from '@theweave/utils';

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
  sortMethod1 = 'popular';

  @state()
  sortMethod2 = 'high';

  @state()
  lookBackString1 = 'week';

  @state()
  lookBackString2 = 'week';

  @state()
  maxNumShownNotifications: number = 50;

  _notificationFeed = new StoreSubscriber(
    this,
    () => this._mossStore.notificationFeed(),
    () => [this._mossStore],
  );

  // function that combines notifications based on their aboutWal, if available
  combineNotifications(notifications: Array<AppletNotification>) {
    const combinedNotifications: Record<
      string,
      { notifications: AppletNotification[]; appletId: AppletId }
    > = {};
    for (let i = 0; i < notifications.length; i++) {
      const notification = notifications[i];
      if (notification.notification.aboutWal) {
        const aboutWal = stringifyWal(notification.notification.aboutWal);
        if (combinedNotifications[aboutWal]) {
          combinedNotifications[aboutWal].notifications.push(notification);
        } else {
          combinedNotifications[aboutWal] = {
            notifications: [notification],
            appletId: notification.appletId,
          };
        }
      }
    }
    return combinedNotifications;
  }

  filterIndividualNotifications(notifications: Array<AppletNotification>) {
    return notifications.filter((notification) => {
      const now = new Date();
      const notificationDate = new Date(notification.notification.timestamp);
      let timeFrame = false;

      switch (this.lookBackString2) {
        case 'minute':
          timeFrame = now.getTime() - notificationDate.getTime() <= 60000;
          break;
        case 'hour':
          timeFrame = now.getTime() - notificationDate.getTime() <= 3600000;
          break;
        case 'day':
          timeFrame = now.getTime() - notificationDate.getTime() <= 86400000;
          break;
        case 'week':
          timeFrame = now.getTime() - notificationDate.getTime() <= 604800000;
          break;
        // case 'month':
        //   timeFrame = now.getTime() - notificationDate.getTime() <= 2592000000;
        //   break;
        // case 'year':
        //   timeFrame = now.getTime() - notificationDate.getTime() <= 31536000000;
        //   break;
        case 'all':
          timeFrame = true;
          break;
      }

      return timeFrame && notification.notification.urgency === this.sortMethod2;
    });
  }

  sortNotifications(
    combinedNotifications: Record<
      string,
      { notifications: AppletNotification[]; appletId: AppletId }
    >,
  ) {
    let filteredByTime: Record<
      string,
      { notifications: AppletNotification[]; appletId: AppletId }
    > = {};
    let now = Date.now();
    let lookBackInt = 0;
    switch (this.lookBackString1) {
      case 'minute':
        lookBackInt = 60 * 1000;
        break;
      case 'hour':
        lookBackInt = 60 * 60 * 1000;
        break;
      case 'day':
        lookBackInt = 24 * 60 * 60 * 1000;
        break;
      case 'week':
        lookBackInt = 7 * 24 * 60 * 60 * 1000;
        break;
      // case 'month':
      //   lookBackInt = 30 * 24 * 60 * 60 * 1000;
      //   break;
      // case 'year':
      //   lookBackInt = 365 * 24 * 60 * 60 * 1000;
      // break;
      // case 'all':
      //   lookBackInt = 999999999999999999999999999999;
      //   break;
      default:
        lookBackInt = 7 * 24 * 60 * 60 * 1000;
    }
    for (let aboutWal in combinedNotifications) {
      let latestNotification = combinedNotifications[aboutWal].notifications.reduce(
        (latest, current) => {
          return current.notification.timestamp > latest.notification.timestamp ? current : latest;
        },
      );
      if (now - latestNotification.notification.timestamp < lookBackInt) {
        filteredByTime[aboutWal] = combinedNotifications[aboutWal];
      }
    }
    switch (this.sortMethod1) {
      case 'active':
        // TODO: Implement mixed sorting
        // function calculateActiveScore(timestamp: number): number {
        //   const now = Date.now();
        //   const hoursPast = (now - timestamp) / 3600000; // Convert milliseconds to hours
        //   let score = 10;
        //   let timePoints = 1;

        //   for (let i = 1; i <= hoursPast; i++) {
        //     score -= timePoints;
        //     timePoints = Math.max(0, timePoints - 0.1); // Ensure timePoints doesn't go below 0
        //   }

        //   return score;
        // }

        // return Object.keys(combinedNotifications).sort((a, b) => {
        //   let scoreA = combinedNotifications[a].notifications.reduce((total, notification) => {
        //     return total + calculateActiveScore(notification.notification.timestamp);

        //   }, 0);

        //   let scoreB = combinedNotifications[b].notifications.reduce((total, notification) => {
        //     return total + calculateActiveScore(notification.notification.timestamp);
        //   }, 0);

        //   return scoreB - scoreA;
        // });

        return Object.keys(filteredByTime).sort((a, b) => {
          return filteredByTime[b].notifications.length - filteredByTime[a].notifications.length;
        });
      case 'latest':
        return Object.keys(filteredByTime).sort((a, b) => {
          let latestNotificationA = filteredByTime[a].notifications.reduce((latest, current) => {
            return current.notification.timestamp > latest.notification.timestamp
              ? current
              : latest;
          });

          let latestNotificationB = filteredByTime[b].notifications.reduce((latest, current) => {
            return current.notification.timestamp > latest.notification.timestamp
              ? current
              : latest;
          });
          return (
            latestNotificationB.notification.timestamp - latestNotificationA.notification.timestamp
          );
        });
      case 'popular':
        // TODO: Implement mixed sorting
        // function calculatePopularScore(timestamp: number): number {
        //   const now = Date.now();
        //   const hoursPast = (now - timestamp) / 3600000; // Convert milliseconds to hours
        //   let score = 10;
        //   let timePoints = 1;

        //   for (let i = 1; i <= hoursPast; i++) {
        //     score -= timePoints;
        //     timePoints = Math.max(0, timePoints - 0.1); // Ensure timePoints doesn't go below 0
        //   }

        //   return score;
        // }
        return Object.keys(filteredByTime).sort((a, b) => {
          let numberOfAgentsCountA = new Set(
            filteredByTime[a].notifications
              .filter((notification) => notification.notification.fromAgent)
              .map((notification) => encodeAndStringify(notification.notification.fromAgent)),
          ).size;
          let numberOfAgentsCountB = new Set(
            filteredByTime[b].notifications
              .filter((notification) => notification.notification.fromAgent)
              .map((notification) => encodeAndStringify(notification.notification.fromAgent)),
          ).size;
          return numberOfAgentsCountB - numberOfAgentsCountA;
        });
      default:
        return [];
    }
  }

  getButtonStyle(method) {
    return this.sortMethod1 === method
      ? 'background-color: #44b134; color: #000'
      : 'background-color: #193423; color: #fff';
  }

  render() {
    const combinedNotifications = this.combineNotifications(this._notificationFeed.value);
    const sortedNotifications = this.sortNotifications(combinedNotifications);
    const filteredIndividualNotifications = this.filterIndividualNotifications(
      this._notificationFeed.value,
    );
    const displayShowMoreButton =
      filteredIndividualNotifications.length > this.maxNumShownNotifications;

    return html`
      <div class="column feed">
        <div class="sort-buttons">
          <div style="color: #fff; font-size: 20px; font-weight: bold; margin-bottom: 6px;">
            Activity currents
          </div>
          <button
            @click=${() => (this.sortMethod1 = 'popular')}
            style=${this.getButtonStyle('popular')}
          >
            Popular
          </button>
          <button
            @click=${() => (this.sortMethod1 = 'active')}
            style=${this.getButtonStyle('active')}
          >
            Active
          </button>
          <button
            @click=${() => (this.sortMethod1 = 'latest')}
            style=${this.getButtonStyle('latest')}
          >
            Latest
          </button>
          <select
            class="time-select"
            @change=${(e) => {
              // By default, notifications 1 week back should already be loaded
              if (this.lookBackString1 === 'month') {
                this._mossStore.loadNotificationFeed(30);
              }
              this.lookBackString1 = e.target.value;
            }}
            .value=${this.lookBackString1 || 'day'}
          >
            <option value="minute">Last minute</option>
            <option value="hour">Last hour</option>
            <option value="day">Last 24 hours</option>
            <option value="week">Last week</option>
            <!-- <option value="month">Last month</option> -->
            <!-- <option value="year">Last year</option>
            <option value="all">All time</option> -->
          </select>
        </div>
        <div style="overflow-y: auto; padding-bottom: 15px;">
          ${sortedNotifications.length === 0
            ? html`
                <div
                  style="background: white; border-radius: 10px; background: transparent; color: #468c2f;"
                >
                  Your activity will appear here
                </div>
              `
            : sortedNotifications.map((aboutWal) => {
                const notifications = combinedNotifications[aboutWal].notifications;
                const appletHash: AppletHash = appletHashFromAppId(
                  appIdFromAppletId(combinedNotifications[aboutWal].appletId),
                );
                return html`
                  <activity-asset
                    @open-wal=${async (e) => {
                      this.dispatchEvent(
                        new CustomEvent('open-wal', {
                          detail: e.detail,
                          bubbles: true,
                          composed: true,
                        }),
                      );
                    }}
                    .notifications=${notifications}
                    .wal=${aboutWal}
                    .appletHash=${appletHash}
                  ></activity-asset>
                `;
              })}
        </div>
      </div>
      <div class="column feed">
        <div style="color: #fff; font-size: 20px; font-weight: bold; margin-bottom: 6px;">
          All notifications
        </div>
        <div class="sort-buttons">
          <button
            @click=${() => (this.sortMethod2 = 'high')}
            class="sort-button"
            style=${this.sortMethod2 === 'high'
              ? 'background-color: #44b134; color: #000'
              : 'background-color: #193423; color: #fff'}
          >
            High
          </button>
          <button
            @click=${() => (this.sortMethod2 = 'medium')}
            class="sort-button"
            style=${this.sortMethod2 === 'medium'
              ? 'background-color: #44b134; color: #000'
              : 'background-color: #193423; color: #fff'}
          >
            Medium
          </button>
          <button
            @click=${() => (this.sortMethod2 = 'low')}
            class="sort-button"
            style=${this.sortMethod2 === 'low'
              ? 'background-color: #44b134; color: #000'
              : 'background-color: #193423; color: #fff'}
          >
            Low
          </button>
          <select
            class="time-select"
            @change=${(e) => {
              // By default, notifications 1 week back should already be loaded
              if (this.lookBackString2 === 'month') {
                this._mossStore.loadNotificationFeed(30);
              }
              this.lookBackString2 = e.target.value;
            }}
            .value=${this.lookBackString2 || 'day'}
          >
            <option value="minute">Last minute</option>
            <option value="hour">Last hour</option>
            <option value="day">Last 24 hours</option>
            <option value="week">Last week</option>
            <!-- <option value="month">Last month</option> -->
            <!-- <option value="year">Last year</option>
            <option value="all">All time</option> -->
          </select>
        </div>
        <div class="column" style="overflow-y: auto; padding-bottom: 80px;">
          ${filteredIndividualNotifications.length === 0
            ? html`
                <div
                  style="background: white; border-radius: 10px; background: transparent; color: #468c2f;"
                >
                  Your notifications will appear here
                </div>
              `
            : filteredIndividualNotifications.slice(0, this.maxNumShownNotifications).map(
                (notification) => html`
                  <notification-asset
                    style="display: flex; flex: 1;"
                    .notification=${notification.notification}
                    .appletHash=${appletHashFromAppId(appIdFromAppletId(notification.appletId))}
                    @open-applet-main=${(e) => {
                      console.log('notification clicked', e.detail);
                      this.dispatchEvent(
                        new CustomEvent('open-applet-main', {
                          detail: appletHashFromAppId(appIdFromAppletId(notification.appletId)),
                          bubbles: true,
                          composed: true,
                        }),
                      );
                    }}
                  ></notification-asset>
                `,
              )}
          ${displayShowMoreButton
            ? html`<div class="row" style="justify-content: center;">
                <button
                  @click=${() => {
                    this.maxNumShownNotifications += 50;
                  }}
                  style="margin-top: 20px; with: 80px;"
                >
                  Show More
                </button>
              </div>`
            : html``}
        </div>
      </div>
    `;
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex: 1;
        /* background-color: var(--moss-dark-green); */
        border-radius: 8px;
      }
      .feed {
        padding: 30px;
        height: calc(100vh - 70px);
      }
      .sort-buttons {
        margin-bottom: 10px;
        min-width: 330px;
      }
      .sort-buttons button {
        margin-right: 5px;
        padding: 5px 10px;
        border-radius: 5px;
        border: none;
        cursor: pointer;
      }
      .sort-buttons button:hover {
        background-color: #53d43f;
      }
      .time-select {
        background-color: #193423;
        color: #fff;
        border: none;
        padding: 5px 10px;
        border-radius: 5px;
        cursor: pointer;
        border: 0;
        outline: 0;
      }
      .time-select:focus-visible {
        outline: none;
      }
    `,
    mossStyles,
  ];
}

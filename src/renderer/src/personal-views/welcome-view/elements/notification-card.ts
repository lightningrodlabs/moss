import { pipe, StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { html, LitElement, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { until } from 'lit/directives/until.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { localized } from '@lit/localize';
import type { FrameNotification } from '@theweave/api';
import { mossStoreContext } from '../../../context.js';
import { consume } from '@lit/context';
import { MossStore } from '../../../moss-store.js';
import { AppletHash } from '@theweave/api';
import { msg } from '@lit/localize';
// import { formatDistanceToNow } from 'date-fns';
import { AppletNotification } from '../../../types.js';
import { mossStyles } from '../../../shared-styles.js';
import { decodeHashFromBase64, AgentPubKey, encodeHashToBase64 } from '@holochain/client';
import TimeAgo from 'javascript-time-ago';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@holochain-open-dev/profiles/dist/elements/agent-avatar.js';
import '../../../applets/elements/applet-logo.js';
import '../../../applets/elements/applet-title.js';
import '../../../elements/dialogs/loading-dialog.js';

@localized()
@customElement('notification-card')
export class NotificationCard extends LitElement {
  @consume({ context: mossStoreContext })
  @state()
  _mossStore!: MossStore;

  @property()
  notifications!: AppletNotification[];

  @property()
  appletHash!: AppletHash;

  @property()
  notification: FrameNotification | undefined;

  @state()
  private _processedBody: string | undefined;

  @state()
  private _lastProcessedNotificationId: string | undefined;

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

  timeAgo = new TimeAgo('en-US');

  renderLogo(logo: string | undefined) {
    if (!logo) return html``;

    return html`
      <img
        style="height: 14px; width: 14px; margin-bottom: -2px; margin-right: 3px;"
        title="${this.getAppletName()}"
        .src=${logo}
        alt="${this.getAppletName()}"
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
          .headline=${msg('Error fetching the tool logo')}
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
            style="height: 48px; width: 48px; margin-bottom: -2px; margin-right: 3px;"
          />
        `;
      case 'error':
        return html`error`;
    }
  }

  renderFirstGroupProfileName() {
    switch (this._groupProfiles.value.status) {
      case 'pending':
        return html`loading...`;
      case 'complete':
        const groupProfile = this._groupProfiles.value.value[0];
        return html`${groupProfile?.name ?? 'Unknown Group'}`;
      case 'error':
        return html`error`;
    }
  }

  private extractAgentKeys(text: string): string[] {
    const agentKeyRegex = /(uhCAk[A-Za-z0-9_-]{48})/g;
    const agentKeys: string[] = [];
    let match;
    while ((match = agentKeyRegex.exec(text)) !== null) {
      agentKeys.push(match[1]);
    }
    return agentKeys;
  }

  private async processBodyWithAgentNames(body: string): Promise<string> {
    const agentKeys = this.extractAgentKeys(body);
    if (agentKeys.length === 0) return body;

    const agentNamesAndIcons = await Promise.all(agentKeys.map((key) => this.getAgentNameAndIcon(key)));
    let modifiedBody = body;
    agentKeys.forEach((key, index) => {
      const name = agentNamesAndIcons[index]?.[0] || key;
      modifiedBody = modifiedBody.replace(`${key}`, `<b>${name}</b>`);
    });
    return modifiedBody;
  }

  private async getAgentNameAndIcon(pubkeyB64: string): Promise<Array<string>> {
    try {
      // console.log('Looking up profile for agent key:', pubkeyB64);
      let agentPubKey: AgentPubKey;
      try {
        agentPubKey = decodeHashFromBase64(pubkeyB64);
      } catch (e) {
        console.error('Failed to decode agent pub key from base64:', e);
        return [pubkeyB64.slice(0, 8) + "...", '']; // Fallback
      }

      // Get the group stores for this applet
      const groupStoreMap = await toPromise(this._mossStore.groupsForApplet.get(this.appletHash));

      // Try to get the profile from any of the groups and use the first one
      const groupStores = Array.from(groupStoreMap.values());
      if (groupStores.length === 0) {
        return [pubkeyB64.slice(0, 8) + "...", '']; // Fallback
      }

      const firstGroupStore = groupStores[0];
      const profileStore = await toPromise(firstGroupStore.membersProfiles.get(agentPubKey));

      if (profileStore && profileStore.type === 'profile') {
        return [profileStore.profile.entry.nickname || pubkeyB64.slice(0, 8), profileStore.profile.entry.fields.avatar || ''];
      }

      // console.log('No profile found for agent:', pubkeyB64);
      return [pubkeyB64.slice(0, 8) + "...", '']; // Fallback
    } catch (error) {
      // console.error('Failed to get agent name:', error);
      return [pubkeyB64.slice(0, 8) + "...", '']; // Fallback
    }
  }

  render() {
    const body = this.notification?.body ?? '';
    const notificationId = `${this.notification?.timestamp}-${body}`;

    // Only process body if notification changed
    if (this._lastProcessedNotificationId !== notificationId) {
      this._lastProcessedNotificationId = notificationId;
      this._processedBody = undefined; // Reset while processing
      this.processBodyWithAgentNames(body).then((processed) => {
        this._processedBody = processed;
      });
    }

    const displayBody = this._processedBody ?? body;
    const fromAgentKey = this.notification?.fromAgent ? encodeHashToBase64(this.notification.fromAgent) : undefined;
    const aboutWal = this.notification?.aboutWal;
    // console.log('Rendering notification card:', this.notification);

    switch (this.appletLogo.value.status) {
      case 'pending':
        return html``;
      case 'complete':
        return html`
        <div
          class="column notification-card"
        >
          <div class="notification-left">
            ${this.renderFirstGroupProfileIcon()} ${false ? this.renderAppletLogo() : ""}
            ${fromAgentKey ? until(
          this.getAgentNameAndIcon(fromAgentKey).then(([name, icon]) =>
            icon
              ? html`<img src=${icon} class="profile-img" title=${name} alt=${name} />`
              : html`<div class="profile-img" title=${name}>${name.charAt(0).toUpperCase()}</div>`,
          ),
          html`<sl-skeleton class="profile-img" effect="pulse"></sl-skeleton>`,
        ) : html``}
          </div>
          <div class="notification-center">
            <span>${unsafeHTML(displayBody)}</span>
            
              <!-- ${fromAgentKey ? until(
          this.getAgentNameAndIcon(fromAgentKey).then(([name, _icon]) => html`from <b>${name}</b>`),
          html`<sl-skeleton style="width: 60px;" effect="pulse"></sl-skeleton>`,
        ) : html``} -->
            in
            <b> ${this.renderFirstGroupProfileName()} </b>
          </div>
          <div class="notification-right">
            <div class="notification-date">
              ${this.notification
            ? this.timeAgo.format(new Date(this.notification.timestamp), 'twitter')
            : 'unknown date'} ago
            </div>
            <div class="notification-buttons">
              ${aboutWal ? html`
                <sl-tooltip content="Open asset in sidebar" placement="left">
                  <button
                    class="open-wal-button"
                    @click=${() => {
              console.log('Dispatching open-wal event for notification:', this.notification);
              this.dispatchEvent(
                new CustomEvent('open-wal', {
                  detail: this.notification?.aboutWal,
                  bubbles: true,
                  composed: true,
                }),
              );
            }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M16 8C16 8 13 2.5 8 2.5C3 2.5 0 8 0 8C0 8 3 13.5 8 13.5C13 13.5 16 8 16 8ZM1.1727 8C1.22963 7.91321 1.29454 7.81677 1.36727 7.71242C1.70216 7.23193 2.19631 6.5929 2.83211 5.95711C4.12103 4.66818 5.88062 3.5 8 3.5C10.1194 3.5 11.879 4.66818 13.1679 5.95711C13.8037 6.5929 14.2978 7.23193 14.6327 7.71242C14.7055 7.81677 14.7704 7.91321 14.8273 8C14.7704 8.08679 14.7055 8.18323 14.6327 8.28758C14.2978 8.76807 13.8037 9.4071 13.1679 10.0429C11.879 11.3318 10.1194 12.5 8 12.5C5.88062 12.5 4.12103 11.3318 2.83211 10.0429C2.19631 9.4071 1.70216 8.76807 1.36727 8.28758C1.29454 8.18323 1.22963 8.08679 1.1727 8Z" fill="#151A11"/>
                  <path d="M8 5.5C6.61929 5.5 5.5 6.61929 5.5 8C5.5 9.38071 6.61929 10.5 8 10.5C9.38071 10.5 10.5 9.38071 10.5 8C10.5 6.61929 9.38071 5.5 8 5.5ZM4.5 8C4.5 6.067 6.067 4.5 8 4.5C9.933 4.5 11.5 6.067 11.5 8C11.5 9.933 9.933 11.5 8 11.5C6.067 11.5 4.5 9.933 4.5 8Z" fill="#151A11"/>
                </svg>
              </button>
            </sl-tooltip>
          ` : html``}

          <button
            class="open-applet-button"
            @click=${() => {
            this.dispatchEvent(
              new CustomEvent('open-applet-main', {
                detail: {
                  applet: this.appletHash,
                  wal: this.notification?.aboutWal,
                },
                bubbles: true,
                composed: true,
              }),
            );
          }}
              >
                Open in ${this.getAppletName()} ↗
              </button>
            </div>
        </div>
        </div>`;

      case 'error':
        console.error(`Failed to get applet logo: ${this.appletLogo.value.error}`);
        return html`[Unknown]`;
    }
  }

  static styles = [
    mossStyles,
    css`
      .activity-asset-outer {
        display: flex;
        flex-direction: column;
      }

      .asset-title {
        font-size: 20px;
      }

      .notification-card {
        flex: 1;
        /* gap: 28px; */
        width: 540px;
        min-height: 64px;
        border-radius: 20px;
        background: #FFF;
        color: var(--moss-dark-button);
        display: flex;
        flex-direction: row;
        position: relative;
        cursor: pointer;
      }

      .notification-left {
        padding: 6px;
        width: 64px;
        display: flex;
        align-items: center;
      }

      .profile-img {
        width: 32px;
        height: 32px;
        border: 2px solid #fff;
        border-radius: 50%;
        position: relative;
        top: -10px;
        left: -20px;
      }

      .notification-center {
        flex: 1;
        padding: 12px;
        max-width: 330px;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--Moss-dark-button, #151A11);
        font-size: 14px;
        font-style: normal;
        line-height: 20px; /* 142.857% */
      }

      .notification-right {
        position: absolute;
        right: 0;
        top: 0;
        bottom: 0;
        width: 320px;
        border-radius: 20px;
        padding: 24px;
        padding-right: 16px;
        display: flex;
        align-items: center;
        justify-content: right;
        pointer-events: none;
      }

      .notification-right::before {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(90deg, rgba(255, 255, 255, 0.00) 0%, var(--moss-main-green, #E0EED5) 46.63%);
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .notification-card:hover > .notification-right::before {
        opacity: 1;
      }

      .notification-buttons {
        z-index: 1;
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
        display: flex;
        gap: 4px;
      }

      .notification-buttons button {
        background: #fff;
        color: var(--moss-dark-button);
        cursor: pointer;
        display: flex;
        padding: 8px 10px;
        justify-content: center;
        align-items: center;
        gap: 10px;
        border-radius: 8px;
        border: none;
        transition: background 0.1s ease, color 0.1s ease;
      }

      .open-wal-button {
        width: 32px;
        height: 32px;
      }

      .notification-buttons button:hover {
        background: var(--moss-dark-button);
        color: #fff;
      }

      button svg path {
        transition: fill 0.1s ease;
      }

      .notification-buttons button:hover svg path {
        fill: #fff;
      }

      .notification-card:hover .notification-buttons {
        opacity: 1;
        pointer-events: auto;
      }

      .notification-card:hover .notification-date {
        opacity: 0;
      }

      .notification-title {
        font-weight: bold;
        color: var(--Moss-dark-button);
        flex: 1;
      }
      .notification-date {
        font-size: 0.9em;
        color: var(--moss-purple);
        position: relative;
        z-index: 1;
        transition: opacity 0.2s ease;
        position: absolute;
      }
      .notification-content {
        font-size: 1em;
        color: var(--Moss-dark-button);
      }
    `,
  ];
}

import { pipe, StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { html, LitElement, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { until } from 'lit/directives/until.js';
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
import { mossStyles } from '../../shared-styles.js';
import { decodeHashFromBase64, AgentPubKey } from '@holochain/client';

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
            style="height: 16px; width: 16px; margin-bottom: -2px; margin-right: 3px;"
          />
        `;
      case 'error':
        return html`error`;
    }
  }

  private extractAgentKeys(text: string): string[] {
    const agentKeyRegex = /([A-Za-z0-9_-]{53})/g;
    const agentKeys: string[] = [];
    let match;
    while ((match = agentKeyRegex.exec(text)) !== null) {
      agentKeys.push(match[1]);
    }
    return agentKeys;
  }

  private async getAgentName(pubkeyB64: string): Promise<string> {
    try {
      // console.log('Looking up profile for agent key:', pubkeyB64);
      const agentPubKey: AgentPubKey = decodeHashFromBase64(pubkeyB64);

      // Get the group stores for this applet
      const groupStoreMap = await toPromise(this._mossStore.groupsForApplet.get(this.appletHash));

      // Try to get the profile from any of the groups (we'll use the first one)
      const groupStores = Array.from(groupStoreMap.values());
      if (groupStores.length === 0) {
        return pubkeyB64.slice(0, 8); // Fallback to truncated key
      }

      const firstGroupStore = groupStores[0];
      const profileStore = await toPromise(firstGroupStore.membersProfiles.get(agentPubKey));

      if (profileStore && profileStore.type === 'profile') {
        // console.log('Found profile for agent:', pubkeyB64, profileStore.profile.entry.nickname);
        return profileStore.profile.entry.nickname || pubkeyB64.slice(0, 8);
      }

      // console.log('No profile found for agent:', pubkeyB64);
      return pubkeyB64.slice(0, 8); // Fallback
    } catch (error) {
      // console.error('Failed to get agent name:', error);
      return pubkeyB64.slice(0, 8); // Fallback
    }
  }

  render() {
    // console.log('Rendering notification:', this.notification);
    const body = this.notification?.body ?? '';
    const agentKeys = this.extractAgentKeys(body);
    // console.log('Extracted agent keys from body:', agentKeys);
    const agentNamePromises = agentKeys.map((key) => this.getAgentName(key));
    const bodyWithNamesPromise = Promise.all(agentNamePromises).then((agentNames) => {
      let modifiedBody = body;
      agentKeys.forEach((key, index) => {
        const name = agentNames[index];
        modifiedBody = modifiedBody.replace(`${key}`, `${name}`);
      });
      return modifiedBody;
    });

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
          <div>${until(bodyWithNamesPromise, body)}</div>
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
        padding: 10px;
        margin-bottom: 10px;
        border-radius: 5px;
        background: var(--moss-dark-green);
        color: #fff;
        flex: 1;
      }
      .notification-card:hover {
        background: var(--moss-hint-green);
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

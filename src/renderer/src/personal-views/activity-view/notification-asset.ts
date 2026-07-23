import { completed, pipe, StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { html, LitElement, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { until } from 'lit/directives/until.js';
import { localized } from '@lit/localize';
import type { FrameNotification, GroupProfile } from '@theweave/api';
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
import { MossNotification } from '../../types.js';
import { mossStyles } from '../../shared-styles.js';
import { decodeHashFromBase64, AgentPubKey, DnaHashB64 } from '@holochain/client';

@localized()
@customElement('notification-asset')
export class NotificationAsset extends LitElement {
  @consume({ context: mossStoreContext })
  @state()
  _mossStore!: MossStore;

  @property()
  notifications!: MossNotification[];

  @property()
  appletHash: AppletHash | undefined;

  @property()
  groupDnaHash: DnaHashB64 | undefined;

  @property()
  notification: FrameNotification | undefined;

  @property()
  sourceName: string | undefined;

  _groupProfiles = new StoreSubscriber(
    this,
    () => {
      if (!this.appletHash) return completed([] as (GroupProfile | undefined)[]);
      return pipe(this._mossStore.groupsForApplet.get(this.appletHash)!, async (groupStoreMap) => {
        const groupProfiles = await Promise.all(
          Array.from(groupStoreMap.values()).map(async (groupStore) =>
            toPromise(groupStore!.groupProfile),
          ),
        );
        return groupProfiles;
      });
    },
    () => [this.appletHash, this._mossStore],
  );

  appletLogo = new StoreSubscriber(
    this,
    () => {
      if (!this.appletHash) return completed(undefined as string | undefined);
      return this._mossStore.appletLogo.get(this.appletHash)!;
    },
    () => [this.appletHash],
  );

  appletName = new StoreSubscriber(
    this,
    () => {
      if (!this.appletHash) return completed(undefined as string | undefined);
      return pipe(this._mossStore.appletStores.get(this.appletHash)!, (appletStore) => {
        if (appletStore) {
          return appletStore.applet.custom_name;
        }
        return undefined;
      });
    },
    () => [this.appletHash],
  );

  // For group notifications - get the group profile
  _groupProfile = new StoreSubscriber(
    this,
    () => {
      if (!this.groupDnaHash) return completed(undefined as GroupProfile | undefined);
      return pipe(this._mossStore.groupStores, async (groupStoresMap) => {
        const groupStore = groupStoresMap.get(decodeHashFromBase64(this.groupDnaHash!));
        if (groupStore) {
          return toPromise(groupStore.groupProfile);
        }
        return undefined;
      });
    },
    () => [this.groupDnaHash, this._mossStore],
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
    if (!this.appletHash) return html``;
    switch (this.appletLogo.value?.status) {
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
      default:
        return html``;
    }
  }
  // renderAppletLogo() {
  //   return html`${JSON.stringify(this.appletLogo.value)}`;
  // }

  getAppletName() {
    if (!this.appletHash) return '';
    switch (this.appletName.value?.status) {
      case 'pending':
        return 'Loading...';
      case 'complete':
        return this.appletName.value.value;
      case 'error':
        return 'Failed to load applet name';
      default:
        return '';
    }
  }

  getSourceName(): string {
    if (this.appletHash) {
      return this.getAppletName() || '';
    }
    // For group notifications, use the provided sourceName
    if (this.sourceName) {
      return this.sourceName;
    }
    // Fallback to group name if available
    if (this.groupDnaHash && this._groupProfile.value?.status === 'complete') {
      const profile = this._groupProfile.value.value;
      return profile?.name || '';
    }
    return '';
  }

  renderFirstGroupProfileIcon() {
    // For group notifications, render the group profile icon
    if (this.groupDnaHash) {
      switch (this._groupProfile.value?.status) {
        case 'pending':
          return html`<sl-skeleton style="height: 16px; width: 16px;" effect="pulse"></sl-skeleton>`;
        case 'complete':
          const profile = this._groupProfile.value.value;
          if (!profile?.icon_src) return html``;
          return html`
            <img
              slot="prefix"
              .src=${profile.icon_src}
              alt="${profile.name}"
              title="${this.sourceName || profile.name}"
              style="height: 16px; width: 16px; margin-bottom: -2px; margin-right: 3px;"
            />
          `;
        case 'error':
          return html``;
        default:
          return html``;
      }
    }

    // For applet notifications, render the first group's icon
    if (!this.appletHash) return html``;
    switch (this._groupProfiles.value?.status) {
      case 'pending':
        return html`loading...`;
      case 'complete':
        const groupProfile = this._groupProfiles.value.value?.[0];
        if (!groupProfile?.icon_src) return html``;
        return html`
          <img
            slot="prefix"
            .src=${groupProfile.icon_src}
            alt="${groupProfile.name}"
            title="${groupProfile.name}"
            style="height: 16px; width: 16px; margin-bottom: -2px; margin-right: 3px;"
          />
        `;
      case 'error':
        return html`error`;
      default:
        return html``;
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

  private async getAgentName(pubkeyB64: string): Promise<string> {
    try {
      let agentPubKey: AgentPubKey;
      try {
        agentPubKey = decodeHashFromBase64(pubkeyB64);
      } catch (e) {
        console.error('Failed to decode agent pub key from base64:', e);
        return pubkeyB64.slice(0, 8) + "..."; // Fallback
      }

      // For group notifications, use the group store directly
      if (this.groupDnaHash && !this.appletHash) {
        const allGroupStores = await toPromise(this._mossStore.groupStores);
        const groupStore = allGroupStores.get(decodeHashFromBase64(this.groupDnaHash));
        if (groupStore) {
          const profileStore = await toPromise(groupStore.membersProfiles.get(agentPubKey)!);
          if (profileStore && profileStore.type === 'profile') {
            return profileStore.profile.entry.nickname || pubkeyB64.slice(0, 8);
          }
        }
        return pubkeyB64.slice(0, 8) + "..."; // Fallback
      }

      // For applet notifications, get the group stores for this applet
      if (!this.appletHash) {
        return pubkeyB64.slice(0, 8) + "..."; // Fallback
      }

      const groupStoreMap = await toPromise(this._mossStore.groupsForApplet.get(this.appletHash)!);

      // Try to get the profile from any of the groups and use the first one
      const groupStores = Array.from(groupStoreMap.values());
      if (groupStores.length === 0) {
        return pubkeyB64.slice(0, 8) + "..."; // Fallback
      }

      const firstGroupStore = groupStores[0];
      const profileStore = await toPromise(firstGroupStore!.membersProfiles.get(agentPubKey)!);

      if (profileStore && profileStore.type === 'profile') {
        return profileStore.profile.entry.nickname || pubkeyB64.slice(0, 8);
      }

      return pubkeyB64.slice(0, 8) + "..."; // Fallback
    } catch (error) {
      return pubkeyB64.slice(0, 8) + "..."; // Fallback
    }
  }

  render() {
    const body = this.notification?.body ?? '';
    const agentKeys = this.extractAgentKeys(body);
    const agentNamePromises = agentKeys.map((key) => this.getAgentName(key));
    const bodyWithNamesPromise = Promise.all(agentNamePromises).then((agentNames) => {
      let modifiedBody = body;
      agentKeys.forEach((key, index) => {
        const name = agentNames[index];
        modifiedBody = modifiedBody.replace(`${key}`, `${name}`);
      });
      return modifiedBody;
    });

    // For group notifications (no appletHash), render directly
    if (this.groupDnaHash && !this.appletHash) {
      return html` <div
        class="column notification-card"
        @click=${() => {
          this.dispatchEvent(
            new CustomEvent('open-applet-main', {
              detail: {
                groupDnaHash: this.groupDnaHash,
              },
              bubbles: true,
              composed: true,
            }),
          );
        }}
      >
        <div class="row notification-title">
          ${this.notification?.title}
          <span style="display: flex; flex: 1;"></span>
          ${this.renderFirstGroupProfileIcon()}
        </div>
        <div>${until(bodyWithNamesPromise, body)}</div>
        <div class="notification-date">
          ${this.notification
          ? formatDistanceToNow(new Date(this.notification?.timestamp), { addSuffix: true })
          : 'unknown date'}
        </div>
      </div>`;
    }

    // For applet notifications
    switch (this.appletLogo.value?.status) {
      case 'pending':
        return html``;
      case 'complete':
        return html` <div
          class="column notification-card"
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
      default:
        return html``;
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

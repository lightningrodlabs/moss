import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import { mossStyles } from '../../shared-styles.js';
import { GroupProfile } from '@theweave/api';
import { consume } from '@lit/context';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { toPromise } from '@holochain-open-dev/stores';
import { encodeHashToBase64 } from '@holochain/client';
import { ToolCompatibilityId } from '@theweave/moss-types';
import { appletHashFromAppId, toolCompatibilityIdFromDistInfo } from '@theweave/utils';
import { WELCOME_DEV_MODE, getMockGroupProfiles } from '../../personal-views/welcome-view/mock-data.js';

@customElement('groups-for-tool')
export class GroupsForTool extends LitElement {
  @consume({ context: mossStoreContext })
  _mossStore!: MossStore;

  @property()
  toolCompatibilityId!: ToolCompatibilityId;

  @property({ type: Number })
  size = 32;

  @property({ type: Number })
  maxGroups = 3;

  @state()
  _status: 'pending' | 'complete' | 'error' = 'pending';

  @state()
  _profiles: GroupProfile[] = [];

  firstUpdated() {
    if (WELCOME_DEV_MODE) {
      this._profiles = getMockGroupProfiles(this.toolCompatibilityId);
      this._status = 'complete';
    } else {
      this._loadProfiles();
    }
  }

  private async _loadProfiles() {
    try {
      // 1. Get all app asset infos to find applets for this tool
      const assetInfos = await toPromise(this._mossStore.allAppAssetInfos);
      const appletHashes = Object.entries(assetInfos)
        .filter(([appId, [info]]) => {
          if (!appId.startsWith('applet#')) return false;
          if (info.distributionInfo.type !== 'web2-tool-list') return false;
          return (
            toolCompatibilityIdFromDistInfo(info.distributionInfo) ===
            this.toolCompatibilityId
          );
        })
        .map(([appId]) => appletHashFromAppId(appId));

      if (appletHashes.length === 0) {
        this._status = 'complete';
        return;
      }

      // 2. Find groups for each applet using direct admin API calls
      //    (bypasses reactive store chain that can block on slow groups)
      const seenGroupHashes = new Set<string>();
      const groupDnaHashes: Array<Uint8Array> = [];

      for (const appletHash of appletHashes) {
        const hashes = await this._mossStore.getGroupsForApplet(appletHash);
        for (const hash of hashes) {
          const b64 = encodeHashToBase64(hash);
          if (!seenGroupHashes.has(b64)) {
            seenGroupHashes.add(b64);
            groupDnaHashes.push(hash);
          }
        }
      }

      if (groupDnaHashes.length === 0) {
        this._status = 'complete';
        return;
      }

      // 3. Get group profiles
      const groupStoresMap = await toPromise(this._mossStore.groupStores);
      const profiles: GroupProfile[] = [];

      for (const hash of groupDnaHashes) {
        const groupStore = groupStoresMap.get(hash);
        if (groupStore) {
          try {
            const profile = await this._awaitGroupProfile(groupStore);
            if (profile) {
              profiles.push(profile);
            }
          } catch (e) {
            console.warn('Failed to get group profile:', e);
          }
        }
      }

      this._profiles = profiles;
      this._status = 'complete';
    } catch (e) {
      console.error('Failed to load groups for tool:', e);
      this._status = 'error';
    }
  }

  /**
   * Wait for a non-undefined group profile with a timeout.
   * The groupProfile store may initially resolve with undefined (local cache miss)
   * before polling fetches the real profile from the network.
   */
  private _awaitGroupProfile(
    groupStore: { groupProfile: { subscribe: (fn: (value: { status: string; value?: GroupProfile }) => void) => () => void } },
  ): Promise<GroupProfile | undefined> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        resolve(undefined);
      }, 10000);

      const unsubscribe = groupStore.groupProfile.subscribe(
        (value: { status: string; value?: GroupProfile }) => {
          if (value.status === 'complete' && value.value !== undefined) {
            clearTimeout(timeout);
            // Defer unsubscribe to avoid unsubscribing inside the callback
            setTimeout(() => {
              unsubscribe();
              resolve(value.value);
            });
          } else if (value.status === 'error') {
            clearTimeout(timeout);
            setTimeout(() => {
              unsubscribe();
              resolve(undefined);
            });
          }
        },
      );
    });
  }

  render() {
    switch (this._status) {
      case 'pending':
        return html`<sl-skeleton
          style="height: ${this.size}px; width: ${this.size}px;"
          effect="pulse"
        ></sl-skeleton>`;
      case 'complete': {
        if (this._profiles.length === 0) {
          return html`<span style="color: rgba(0, 0, 0, 0.40);">None</span>`;
        }
        const displayProfiles = this._profiles.slice(0, this.maxGroups);
        const remainingCount = this._profiles.length - this.maxGroups;
        return html`
          <div style="display: flex; gap: 4px; flex-wrap: wrap; align-items: center;">
            ${displayProfiles.map(
              (profile) => html`
                <sl-tooltip content="${profile.name}" placement="top">
                  <img
                    src="${profile.icon_src}"
                    style="width: ${this.size}px; height: ${this.size}px; border-radius: 8px;"
                  />
                </sl-tooltip>
              `,
            )}
            ${remainingCount > 0
              ? html`
                  <div class="tool-update-more-groups">+${remainingCount}</div>
                `
              : ''}
          </div>
        `;
      }
      case 'error':
        return html`<span style="color: rgba(0, 0, 0, 0.40);">N/A</span>`;
    }
  }

  static get styles() {
    return [
      mossStyles,
      css`
        :host {
          display: flex;
        }

        .tool-update-more-groups {
          display: flex;
          width: 32px;
          padding: 8px 0px;
          justify-content: center;
          align-items: center;
          gap: 10px;
          border-radius: 8px;
          background: #F4FED6;
          color: var(--13, #324D47);
          font-size: 12px;
          font-weight: 500;
        }
      `,
    ];
  }
}

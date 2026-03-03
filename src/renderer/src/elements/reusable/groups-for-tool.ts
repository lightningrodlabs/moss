import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import { mossStyles } from '../../shared-styles.js';
import { GroupProfile } from '@theweave/api';
import { consume } from '@lit/context';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { pipe, StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { DnaHash, encodeHashToBase64 } from '@holochain/client';
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
  _mockProfiles: GroupProfile[] | undefined;

  // Initialized in firstUpdated when not in DEV_MODE
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _groupProfiles: any;

  firstUpdated() {
    if (WELCOME_DEV_MODE) {
      this._mockProfiles = getMockGroupProfiles(this.toolCompatibilityId);
    } else {
      this._groupProfiles = new StoreSubscriber(
        this,
        () =>
          pipe(
            this._mossStore.allAppAssetInfos,
            (assetInfos) => {
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

              return appletHashes;
            },
            async (appletHashes) => {
              const seenGroupHashes = new Set<string>();
              const groupProfiles: Array<GroupProfile | undefined> = [];

              for (const appletHash of appletHashes) {
                const groupStoreMap = await toPromise(
                  this._mossStore.groupsForApplet.get(appletHash)!,
                );
                for (const [groupDnaHash, groupStore] of groupStoreMap.entries()) {
                  const hashB64 = encodeHashToBase64(groupDnaHash as DnaHash);
                  if (!seenGroupHashes.has(hashB64)) {
                    seenGroupHashes.add(hashB64);
                    const profile = await toPromise(groupStore!.groupProfile);
                    groupProfiles.push(profile);
                  }
                }
              }

              return groupProfiles;
            },
          ),
        () => [this.toolCompatibilityId, this._mossStore],
      );
    }
  }

  private _getProfiles(): { status: 'pending' | 'complete' | 'error'; profiles: GroupProfile[] } {
    if (WELCOME_DEV_MODE) {
      return { status: 'complete', profiles: this._mockProfiles ?? [] };
    }

    const value = this._groupProfiles?.value;
    if (!value || value.status === 'pending') {
      return { status: 'pending', profiles: [] };
    }
    if (value.status === 'error') {
      console.error('Failed to get groups for tool: ', value.error);
      return { status: 'error', profiles: [] };
    }
    return {
      status: 'complete',
      profiles: value.value.filter((p): p is GroupProfile => !!p),
    };
  }

  render() {
    const { status, profiles } = this._getProfiles();

    switch (status) {
      case 'pending':
        return html`<sl-skeleton
          style="height: ${this.size}px; width: ${this.size}px;"
          effect="pulse"
        ></sl-skeleton>`;
      case 'complete': {
        if (profiles.length === 0) {
          return html`<span style="color: rgba(0, 0, 0, 0.40);">None</span>`;
        }
        const displayProfiles = profiles.slice(0, this.maxGroups);
        const remainingCount = profiles.length - this.maxGroups;
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

import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tag/tag.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';

import { lazyLoad, StoreSubscriber } from '@holochain-open-dev/stores';

import { weaveClientContext } from '../context';
import { WeaveUrl, weaveUrlToWAL } from '@lightningrodlabs/we-applet';
import { WeaveClient, WeaveServices } from '@lightningrodlabs/we-applet';
import { getAppletsInfosAndGroupsProfiles } from '../utils';
import { sharedStyles } from '@holochain-open-dev/elements';

@localized()
@customElement('wal-link')
export class WalLink extends LitElement {
  @property()
  wal!: WeaveUrl;

  @consume({ context: weaveClientContext, subscribe: true })
  weaveClient!: WeaveClient | WeaveServices;

  @property()
  onlyIcon = false;

  info = new StoreSubscriber(
    this,
    () =>
      lazyLoad(async () => {
        const assetInfo = await window.__WEAVE_API__.assetInfo(weaveUrlToWAL(this.wal));
        if (!assetInfo) return undefined;

        const { groupsProfiles, appletsInfos } = await getAppletsInfosAndGroupsProfiles(
          this.weaveClient as WeaveClient,
          [assetInfo.appletHash],
        );

        return {
          assetInfo,
          groupsProfiles,
          appletsInfos,
        };
      }),
    () => [this.wal],
  );

  render() {
    switch (this.info.value.status) {
      case 'pending':
        return html`<sl-skeleton></sl-skeleton>`;
      case 'complete':
        if (this.info.value.value === undefined) return html``; // TODO: what to put here?

        const { appletsInfos, groupsProfiles, assetInfo } = this.info.value.value;

        return html`
          <sl-tooltip
            ><div slot="content">
              <div class="row" style="align-items: center">
                ${this.onlyIcon ? html` <span>${assetInfo.assetInfo.name},&nbsp;</span> ` : html``}
                <span> ${appletsInfos.get(assetInfo.appletHash)?.appletName} ${msg('in')}</span>
                ${appletsInfos.get(assetInfo.appletHash)?.groupsHashes.map(
                  (groupHash) => html`
                    <img
                      .src=${groupsProfiles.get(groupHash)!.logo_src}
                      style="height: 16px; width: 16px; margin-right: 4px; border-radius: 50%"
                    />
                    <span>${groupsProfiles.get(groupHash)?.name}</span>
                  `,
                )}
              </div>
            </div>
            <sl-tag
              pill
              style="cursor: pointer"
              tabindex="0"
              @click=${() => window.__WEAVE_API__.openWal(weaveUrlToWAL(this.wal))}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  window.__WEAVE_API__.openWal(weaveUrlToWAL(this.wal));
                }
              }}
            >
              <div class="row" style="align-items: center">
                <sl-icon .src=${assetInfo.assetInfo.icon_src}></sl-icon>
                ${this.onlyIcon
                  ? html``
                  : html` <span style="margin-left: 8px">${assetInfo.assetInfo.name}</span> `}
              </div>
            </sl-tag>
          </sl-tooltip>
        `;
      case 'error':
        console.error(this.info.value.error);
        return html`<display-error
          tooltip
          .headline=${msg('Error fetching the entry')}
          .error=${this.info.value.error}
        ></display-error>`;
    }
  }

  static styles = [sharedStyles];
}

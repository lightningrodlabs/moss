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

import { weClientContext } from '../context';
import { Hrl } from '@lightningrodlabs/we-applet';
import { WeClient, WeServices } from '@lightningrodlabs/we-applet';
import { getAppletsInfosAndGroupsProfiles } from '../utils';
import { sharedStyles } from '@holochain-open-dev/elements';

@localized()
@customElement('hrl-link')
export class HrlLink extends LitElement {
  @property()
  hrl!: Hrl;

  @property()
  context: any;

  @consume({ context: weClientContext, subscribe: true })
  weClient!: WeClient | WeServices;

  @property()
  onlyIcon = false;

  info = new StoreSubscriber(
    this,
    () =>
      lazyLoad(async () => {
        const attachableInfo = await this.weClient.attachableInfo({
          hrl: this.hrl,
          context: this.context,
        });
        if (!attachableInfo) return undefined;

        const { groupsProfiles, appletsInfos } = await getAppletsInfosAndGroupsProfiles(
          this.weClient as WeClient,
          [attachableInfo.appletHash],
        );

        return {
          attachableInfo,
          groupsProfiles,
          appletsInfos,
        };
      }),
    () => [this.hrl],
  );

  render() {
    switch (this.info.value.status) {
      case 'pending':
        return html`<sl-skeleton></sl-skeleton>`;
      case 'complete':
        if (this.info.value.value === undefined) return html``; // TODO: what to put here?

        const { appletsInfos, groupsProfiles, attachableInfo } = this.info.value.value;

        return html`
          <sl-tooltip
            ><div slot="content">
              <div class="row" style="align-items: center">
                ${this.onlyIcon
                  ? html` <span>${attachableInfo.attachableInfo.name},&nbsp;</span> `
                  : html``}
                <span>
                  ${appletsInfos.get(attachableInfo.appletHash)?.appletName} ${msg('in')}</span
                >
                ${appletsInfos.get(attachableInfo.appletHash)?.groupsIds.map(
                  (groupId) => html`
                    <img
                      .src=${groupsProfiles.get(groupId)?.logo_src}
                      style="height: 16px; width: 16px; margin-right: 4px; border-radius: 50%"
                    />
                    <span>${groupsProfiles.get(groupId)?.name}</span>
                  `,
                )}
              </div>
            </div>
            <sl-tag
              pill
              style="cursor: pointer"
              tabindex="0"
              @click=${() => this.weClient.openHrl({ hrl: this.hrl, context: this.context })}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  this.weClient.openHrl({ hrl: this.hrl, context: this.context });
                }
              }}
            >
              <div class="row" style="align-items: center">
                <sl-icon .src=${attachableInfo.attachableInfo.icon_src}></sl-icon>
                ${this.onlyIcon
                  ? html``
                  : html`
                      <span style="margin-left: 8px">${attachableInfo.attachableInfo.name}</span>
                    `}
              </div>
            </sl-tag>
          </sl-tooltip>
        `;
      case 'error':
        return html`<display-error
          tooltip
          .headline=${msg('Error fetching the entry')}
          .error=${this.info.value.error}
        ></display-error>`;
    }
  }

  static styles = [sharedStyles];
}

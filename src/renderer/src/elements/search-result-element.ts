import { customElement, property, state } from 'lit/decorators.js';
import { css, html, LitElement } from 'lit';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { sharedStyles } from '@holochain-open-dev/elements';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/menu/menu.js';
import '@shoelace-style/shoelace/dist/components/menu-item/menu-item.js';
import '@shoelace-style/shoelace/dist/components/dropdown/dropdown.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

import '../applets/elements/applet-title.js';

import {
  AppletInfo,
  AttachableLocationAndInfo,
  GroupProfile,
  HrlWithContext,
  WeClient,
  WeServices,
} from '@lightningrodlabs/we-applet';
import { EntryHash } from '@holochain/client';
import { DnaHash } from '@holochain/client';
import { getAppletsInfosAndGroupsProfiles, weClientContext } from '@lightningrodlabs/we-elements';

export interface SearchResult {
  hrlsWithInfo: Array<[HrlWithContext, AttachableLocationAndInfo]>;
  groupsProfiles: ReadonlyMap<DnaHash, GroupProfile>;
  appletsInfos: ReadonlyMap<EntryHash, AppletInfo>;
}

/**
 * @element search-entry
 * @fires entry-selected - Fired when the user selects some entry. Detail will have this shape: { hrl, context }
 */
@localized()
@customElement('search-result-element')
export class SearchResultElement extends LitElement {
  /** Form field properties */

  @consume({ context: weClientContext, subscribe: true })
  @property()
  weClient!: WeClient | WeServices;

  /**
   * @internal
   */
  @property()
  hrlWithContext!: HrlWithContext;

  @state()
  _attachableInfo: AttachableLocationAndInfo | undefined;

  @state()
  _appletsInfos: ReadonlyMap<EntryHash, AppletInfo> | undefined;

  @state()
  _groupProfiles: ReadonlyMap<DnaHash, GroupProfile> | undefined;

  @state()
  _loading = true;

  // @state()
  // _appletStore: StoreSubscriber<AsyncStatus<AppletStore>> | undefined;

  async firstUpdated() {
    const attachableInfo = await this.weClient.attachableInfo(this.hrlWithContext);
    this._attachableInfo = attachableInfo;
    this._loading = false;
    if (attachableInfo) {
      const { appletsInfos, groupsProfiles } = await getAppletsInfosAndGroupsProfiles(
        this.weClient as WeClient,
        [attachableInfo.appletHash],
      );
      this._appletsInfos = appletsInfos;
      this._groupProfiles = groupsProfiles;
    }
  }

  onCopyToClipboard(hrlWithContext: HrlWithContext) {
    this.dispatchEvent(
      new CustomEvent('hrl-to-clipboard', {
        detail: {
          hrlWithContext,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    return html`
      <sl-menu-item style="flex: 1;" .hrlWithContext=${this.hrlWithContext}>
        ${this._attachableInfo
          ? html`
              <sl-icon
                slot="prefix"
                .src=${this._attachableInfo.attachableInfo.icon_src}
                style="margin-right: 16px"
              ></sl-icon>

              <div class="row" style="align-items: center; flex: 1;">
                <span>${this._attachableInfo.attachableInfo.name}</span>
                <span style="flex: 1;"></span>
                ${this._attachableInfo
                  ? html`
                      <span class="placeholder">&nbsp;${msg('in')}&nbsp;</span>
                      <applet-title
                        style="font-weight: bold;"
                        .appletHash=${this._attachableInfo.appletHash}
                      ></applet-title>
                    `
                  : html``}
                ${this._groupProfiles
                  ? html`
                      <span class="placeholder">&nbsp;${msg('of')}&nbsp;</span>
                      ${Array.from(this._groupProfiles.values()).map(
                        (profile) => html`
                          <sl-tooltip content="${profile.name}" hoist position="top">
                            <img
                              .src=${profile.logo_src}
                              alt=${`Group icon of group ${profile.name}`}
                              style="height: 24px; width: 24px; margin-right: 4px; border-radius: 50%" />
                            <sl-tooltip> </sl-tooltip
                          ></sl-tooltip>
                        `,
                      )}
                    `
                  : html``}
              </div>
            `
          : this._loading
            ? html`<span style="flex: 1;">loading...</span>`
            : html`<span style="flex: 1;">[unknown attachable]</span>`}
        <div
          slot="suffix"
          tabindex="0"
          @click=${(e) => {
            e.stopPropagation();
            this.onCopyToClipboard(this.hrlWithContext);
          }}
          @keypress=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              e.stopPropagation();
              this.onCopyToClipboard(this.hrlWithContext);
            }
          }}
        >
          <sl-tooltip content="${msg('Add to Pocket')}" m placement="right" hoist>
            <div class="row center-content to-clipboard">
              <img src="add-to-pocket.svg" style="height: 26px;" />
            </div>
          </sl-tooltip>
        </div>
      </sl-menu-item>
    `;
  }

  static get styles() {
    return [
      sharedStyles,
      css`
        :host {
          display: flex;
        }

        .to-clipboard {
          background: #2eb2d7;
          border-radius: 5px;
          box-shadow: 0 0 3px black;
        }

        .to-clipboard:hover {
          background: #7fd3eb;
        }
      `,
    ];
  }
}

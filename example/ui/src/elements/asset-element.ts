import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { consume } from '@lit/context';

import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import { encodeHashToBase64 } from '@holochain/client';

import {
  AssetLocationAndInfo,
  encodeContext,
  WAL,
  WeaveClient,
  weaveUrlFromWal,
} from '@theweave/api';

import { mdiShareVariantOutline } from '@mdi/js';
import { notify, sharedStyles, wrapPathInSvg } from '@holochain-open-dev/elements';
import { weaveClientContext } from '@theweave/elements';

@localized()
@customElement('asset-element')
export class AssetElement extends LitElement {
  @consume({ context: weaveClientContext as { __context__: WeaveClient } })
  weaveClient!: WeaveClient;

  @property()
  wal!: WAL;

  @state()
  assetInfo: AssetLocationAndInfo | undefined;

  async firstUpdated() {
    this.assetInfo = await this.weaveClient.assets.assetInfo(this.wal);
  }

  handleClick() {
    this.dispatchEvent(
      new CustomEvent('wal-selected', {
        detail: {
          wal: this.wal,
        },
      })
    );
  }

  render() {
    if (!this.assetInfo)
      return html`<div class="row element" style="height: 30px;"><span>loading...</span></div>`;
    console.log('this.assetInfo: ', this.assetInfo.assetInfo);
    return html`
            <div
              class="row element"
              title=${`weave-0.13://hrl/${encodeHashToBase64(this.wal.hrl[0])}/${encodeHashToBase64(
                this.wal.hrl[1]
              )}${this.wal.context ? `?context=${encodeContext(this.wal.context)}` : ''}`}
            >

              <div
                class="row open"
                style="align-items: center; padding: 0; margin: 0;"
                tabindex="0"
                @click=${() => this.handleClick()}
                @keypress.enter=${() => this.handleClick()}
              >
                <div class="row icon-container">
                  <sl-icon
                    style="height: 30px; width: 30px; border-radius: 5px 0 0 5px;"
                    .src=${this.assetInfo.assetInfo.icon_src}
                    alt="${this.assetInfo.assetInfo.name} entry type icon"
                  ></sl-icon>
                </div>
                <div class="row title-container">${this.assetInfo.assetInfo.name}</div>
              </div>
              <!-- <div class="row open">Open</div> -->

              <sl-tooltip .content=${msg('Copy URL')}>
                <div
                  class="row share"
                  tabindex="0"
                  @click=${async () => {
                    const weaveUrl = weaveUrlFromWal(this.wal, false);
                    await navigator.clipboard.writeText(weaveUrl);
                    notify(msg('URL copied.'));
                  }}
                  @keypress=${async (e: KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      const weaveUrl = weaveUrlFromWal(this.wal, false);
                      await navigator.clipboard.writeText(weaveUrl);
                      notify(msg('URL copied.'));
                    }
                  }}
                >
                    <sl-icon .src=${wrapPathInSvg(mdiShareVariantOutline)}><sl-icon>
                </div>
              </sl-tooltip>
              <button @click=${() => {
                this.dispatchEvent(
                  new CustomEvent('remove-wal', {
                    bubbles: true,
                    composed: true,
                  })
                );
              }}>Remove</button>
            </div>
          `;
  }

  static styles = [
    sharedStyles,
    css`
      .element {
        flex: 1;
        align-items: center;
        background: #f5f5f5;
        border-radius: 8px;
        box-shadow: 0 0 5px black;
        cursor: pointer;
      }

      .icon-container {
        width: 40px;
        align-items: center;
        justify-content: center;
      }

      .title-container {
        padding: 0 15px 0 5px;
        /* background: #dbdbdb; */
        align-items: center;
        height: 40px;
        flex: 1;
        font-size: 18px;
      }

      .open {
        border-radius: 8px 0 0 8px;
      }

      .open:hover {
        background: #e6eeff;
      }

      .share {
        background: #a1f374;
        align-items: center;
        justify-content: center;
        height: 40px;
        font-weight: bold;
        width: 40px;
        cursor: pointer;
      }

      .share:hover {
        background: #c8ffaa;
      }

      .clear {
        background: #ffdbdb;
        align-items: center;
        justify-content: center;
        height: 40px;
        font-weight: bold;
        width: 40px;
        border-radius: 0 8px 8px 0;
        cursor: pointer;
      }
      .clear:hover {
        background: #eaabab;
      }
    `,
  ];
}

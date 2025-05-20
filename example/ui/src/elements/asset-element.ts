import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { consume } from '@lit/context';

import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import { encodeHashToBase64, EntryHash } from '@holochain/client';

import {
  AssetLocationAndInfo,
  encodeContext,
  WalRelationAndTags,
  WeaveClient,
  weaveUrlFromWal,
} from '@theweave/api';

import { mdiAlphabeticalVariant, mdiShareVariantOutline, mdiTrashCan } from '@mdi/js';
import { notify, sharedStyles, wrapPathInSvg } from '@holochain-open-dev/elements';
import { weaveClientContext } from '@theweave/elements';

@localized()
@customElement('asset-element')
export class AssetElement extends LitElement {
  @consume({ context: weaveClientContext as { __context__: WeaveClient } })
  weaveClient!: WeaveClient;

  @property()
  walRelationAndTags!: WalRelationAndTags;

  @state()
  assetInfo: AssetLocationAndInfo | undefined;

  async firstUpdated() {
    this.assetInfo = await this.weaveClient.assets.assetInfo(this.walRelationAndTags.wal);
  }

  handleClick() {
    this.dispatchEvent(
      new CustomEvent('wal-selected', {
        detail: {
          wal: this.walRelationAndTags.wal,
        },
      })
    );
  }

  async removeTag(tag: string) {
    this.weaveClient.assets.removeTagsFromAssetRelation(this.walRelationAndTags.relationHash, [
      tag,
    ]);
  }

  render() {
    if (!this.assetInfo)
      return html`<div class="row element" style="height: 30px;"><span>loading...</span></div>`;
    console.log('this.assetInfo: ', this.assetInfo.assetInfo);
    return html`<div
        class="column element"
        title=${`weave-0.14://hrl/${encodeHashToBase64(
          this.walRelationAndTags.wal.hrl[0]
        )}/${encodeHashToBase64(this.walRelationAndTags.wal.hrl[1])}${
          this.walRelationAndTags.wal.context
            ? `?context=${encodeContext(this.walRelationAndTags.wal.context)}`
            : ''
        }`}
      >
        <div class="row">
        <div
          class="column open"
          style="align-items: center; padding: 0; margin: 0;"
          tabindex="0"
          @click=${() => this.handleClick()}
          @keypress.enter=${() => this.handleClick()}
        >
          <div class="row">
            <div class="row icon-container">
              <sl-icon
                style="height: 30px; width: 30px; border-radius: 5px 0 0 5px;"
                .src=${this.assetInfo.assetInfo.icon_src}
                alt="${this.assetInfo.assetInfo.name} entry type icon"
              ></sl-icon>
            </div>
            <div class="row title-container">${this.assetInfo.assetInfo.name}</div>
          </div>
        </div>

          <span style="display: flex; flex: 1;"></span>

          <sl-tooltip .content=${msg('Add Tag')}>
            <div
              class="row taggit"
              style="font-size: 24px;"
              tabindex="0"
              @click=${async () => {
                const selectedTag = await this.weaveClient.assets.userSelectAssetRelationTag();
                if (selectedTag)
                  await this.weaveClient.assets.addTagsToAssetRelation(
                    this.walRelationAndTags.relationHash,
                    [selectedTag]
                  );
              }}
              @keypress=${async (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  const selectedTag = await this.weaveClient.assets.userSelectAssetRelationTag();
                  if (selectedTag)
                    await this.weaveClient.assets.addTagsToAssetRelation(
                      this.walRelationAndTags.relationHash,
                      [selectedTag]
                    );
                }
              }}
            >
                <sl-icon .src=${wrapPathInSvg(mdiAlphabeticalVariant)}><sl-icon>
            </div>
          </sl-tooltip>

          <sl-tooltip .content=${msg('Copy URL')}>
            <div
              class="row share"
              tabindex="0"
              @click=${async () => {
                const weaveUrl = weaveUrlFromWal(this.walRelationAndTags.wal, false);
                await navigator.clipboard.writeText(weaveUrl);
                notify(msg('URL copied.'));
              }}
              @keypress=${async (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  const weaveUrl = weaveUrlFromWal(this.walRelationAndTags.wal, false);
                  await navigator.clipboard.writeText(weaveUrl);
                  notify(msg('URL copied.'));
                }
              }}
            >
                <sl-icon .src=${wrapPathInSvg(mdiShareVariantOutline)}><sl-icon>
            </div>
          </sl-tooltip>
          <sl-tooltip .content=${msg('Remove for everyone')}>
            <div
              class="row clear"
              style="font-size: 24px;"
              tabindex="0"
              @click=${() => {
                this.dispatchEvent(
                  new CustomEvent('remove-wal', {
                    bubbles: true,
                    composed: true,
                  })
                );
              }}
              @keypress=${async (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  this.dispatchEvent(
                    new CustomEvent('remove-wal', {
                      bubbles: true,
                      composed: true,
                    })
                  );
                }
              }}
            >
                <sl-icon .src=${wrapPathInSvg(mdiTrashCan)}><sl-icon>
            </div>
          </sl-tooltip>
        </div>

        ${
          this.walRelationAndTags.tags.length > 0
            ? html`<div class="row" style="margin: 4px; flex-wrap: wrap;">
                ${this.walRelationAndTags.tags.map(
                  (tag) =>
                    html` <div class="row items-center tag-badge">
                      <div class="tag-content">${tag}</div>
                      <button class="btn tag-remove-btn" @click=${() => this.removeTag(tag)}>
                        x
                      </button>
                    </div>`
                )}
              </div>`
            : html``
        }

      </div>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      .element {
        flex: 1;
        background: #f5f5f5;
        border-radius: 8px;
        box-shadow: 0 0 5px black;
        cursor: pointer;
        width: 350px;
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

      .taggit {
        background: #749ef3d3;
        align-items: center;
        justify-content: center;
        height: 40px;
        font-weight: bold;
        width: 40px;
        cursor: pointer;
      }

      .taggit:hover {
        background: #749ef3;
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

      .tag-badge {
        color: white;
        background: #001e41;
        border-radius: 6px;
        margin-right: 3px;
        margin-bottom: 3px;
        /* padding: 2px 5px; */
        font-size: 20px;
        cursor: pointer;
      }

      .tag-badge:focus-visible {
        background: #0058bc;
      }

      .tag-content {
        padding: 0 5px;
        cursor: default;
      }

      .tag-remove-btn {
        padding: 0 5px;
        background: #bb4b4b;
        height: 100%;
        border-radius: 0 6px 6px 0;
        margin: 0;
      }
    `,
  ];
}

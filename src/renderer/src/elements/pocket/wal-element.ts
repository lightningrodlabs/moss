import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';

import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import { encodeHashToBase64 } from '@holochain/client';

import { WAL, weaveUrlFromWal } from '@theweave/api';

import { mossStyles } from '../../shared-styles.js';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { encodeContext } from '../../utils.js';
import { mdiShareVariantOutline } from '@mdi/js';
import { notify, wrapPathInSvg } from '@holochain-open-dev/elements';
import { stringifyWal } from '@theweave/api';

@localized()
@customElement('wal-element')
export class WalElement extends LitElement {
  @consume({ context: mossStoreContext })
  @state()
  _mossStore!: MossStore;

  @property()
  wal!: WAL;

  @property()
  selectTitle: string | undefined;

  // async copyHrl() {
  //   const url = `https://theweave.social/wal?weave-0.14://hrl/${encodeHashToBase64(
  //     this.hrl[0]
  //   )}/${encodeHashToBase64(this.hrl[1])}`;
  //   await navigator.clipboard.writeText(url);

  //   notify(msg("Link copied to the clipboard."));
  // }

  assetInfo = new StoreSubscriber(
    this,
    () => this._mossStore.assetInfo.get(stringifyWal(this.wal)),
    () => [this.wal],
  );

  handleClick() {
    this.dispatchEvent(
      new CustomEvent('wal-selected', {
        detail: {
          wal: this.wal,
        },
      }),
    );
  }

  renderShareAndRemoveBtns() {
    return html`
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

          <sl-tooltip .content=${msg('Remove from Pocket')}>
            <div
              class="row clear"
              tabindex="0"
              @click=${() => {
                this._mossStore.removeWalFromPocket(this.wal);
                this.dispatchEvent(new CustomEvent('wal-removed', {}));
              }}
              @keypress=${async (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  this._mossStore.removeWalFromPocket(this.wal);
                  this.dispatchEvent(new CustomEvent('wal-removed', {}));
                }
              }}
            >
              X
            </div>
          </sl-tooltip>
    `;
  }

  render() {
    switch (this.assetInfo.value.status) {
      case 'pending':
        return html` <div
          class="row element"
          title=${`weave-0.14://hrl/${encodeHashToBase64(this.wal.hrl[0])}/${encodeHashToBase64(
            this.wal.hrl[1],
          )}${this.wal.context ? `?context=${encodeContext(this.wal.context)}` : ''}`}
        >
          <sl-tooltip .content=${msg('Loading...')}>
            <div
              class="row disabled"
              style="align-items: center; padding: 0; margin: 0; margin-left: 3px;cursor: default; opacity: 0.5;"
              tabindex="0"
            >
              <div class="row title-container">${msg('Loading...')}</div>
            </div>
          </sl-tooltip>
          ${this.renderShareAndRemoveBtns()}
        </div>`;
      case 'error':
        const error = this.assetInfo.value.error;
        let appletDisabled = false;
        if (error.toString().includes('CellDisabled')) {
          appletDisabled = true;
        } else {
          console.error('Failed to get asset info for WAL element: ', this.assetInfo.value.error);
        }
        return html` <div
          class="row element"
          title=${`weave-0.14://hrl/${encodeHashToBase64(this.wal.hrl[0])}/${encodeHashToBase64(
            this.wal.hrl[1],
          )}${this.wal.context ? `?context=${encodeContext(this.wal.context)}` : ''}`}
        >
          <sl-tooltip
            .content=${appletDisabled
              ? msg('Cannot be selected - the associated Tool is disabled')
              : this.selectTitle
                ? this.selectTitle
                : msg('Select')}
          >
            <div
              class="row disabled"
              style="align-items: center; padding: 0; margin: 0; cursor: default; opacity: 0.5;"
              tabindex="0"
            >
              <div class="row title-container">
                ${appletDisabled ? msg('Unknown') : msg('Error')}
              </div>
            </div>
          </sl-tooltip>
          ${this.renderShareAndRemoveBtns()}
        </div>`;
      case 'complete':
        if (this.assetInfo.value.value) {
          return html`
            <div
              class="row element"
              title=${`weave-0.14://hrl/${encodeHashToBase64(this.wal.hrl[0])}/${encodeHashToBase64(
                this.wal.hrl[1],
              )}${this.wal.context ? `?context=${encodeContext(this.wal.context)}` : ''}`}
            >
              <sl-tooltip .content=${this.selectTitle ? this.selectTitle : msg('Select')}>
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
                      .src=${this.assetInfo.value.value.icon_src}
                      alt="${this.assetInfo.value.value.name} entry type icon"
                    ></sl-icon>
                  </div>
                  <div class="row title-container">${this.assetInfo.value.value.name}</div>
                </div>
              </sl-tooltip>
              <!-- <div class="row open">Open</div> -->
              ${this.renderShareAndRemoveBtns()}
            </div>
          `;
        } else {
          return html`AssetInfo undefined`;
        }
      default:
        return html`<div>Invalid AsyncStatus: ${(this.assetInfo.value as any).status}</div>`;
    }
  }

  static styles = [
    mossStyles,
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

      .disabled {
        border-radius: 8px 0 0 8px;
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

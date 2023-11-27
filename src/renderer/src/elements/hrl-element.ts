import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit-labs/context';

import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import { decodeHashFromBase64 } from '@holochain/client';

import { HrlB64WithContext } from '@lightningrodlabs/we-applet';

import { weStyles } from '../shared-styles.js';
import { weStoreContext } from '../context.js';
import { WeStore } from '../we-store.js';
import { hrlB64WithContextToRaw } from '../utils.js';

@localized()
@customElement('hrl-element')
export class HrlElement extends LitElement {
  @consume({ context: weStoreContext })
  @state()
  _weStore!: WeStore;

  @property()
  hrlB64!: HrlB64WithContext;

  @property()
  selectTitle: string | undefined;

  // async copyHrl() {
  //   const url = `https://lightningrodlabs.org/we?we://hrl/${encodeHashToBase64(
  //     this.hrl[0]
  //   )}/${encodeHashToBase64(this.hrl[1])}`;
  //   await navigator.clipboard.writeText(url);

  //   notify(msg("Link copied to the clipboard."));
  // }

  entryInfo = new StoreSubscriber(
    this,
    () =>
      this._weStore.entryInfo
        .get(decodeHashFromBase64(this.hrlB64.hrl[0]))
        .get(decodeHashFromBase64(this.hrlB64.hrl[1])),
    () => [this.hrlB64],
  );

  handleClick() {
    this.dispatchEvent(
      new CustomEvent('hrl-selected', {
        detail: {
          hrlWithContext: hrlB64WithContextToRaw(this.hrlB64),
        },
      }),
    );
  }

  render() {
    switch (this.entryInfo.value.status) {
      case 'pending':
        return html`<div class="row element" style="height: 30px;"><span>loading...</span></div>`;
      case 'error':
        return html`<div>Error</div>`;
      case 'complete':
        if (this.entryInfo.value.value) {
          return html`
            <div
              class="row element"
              title=${`https://lightningrodlabs.org/we?we://hrl/${this.hrlB64.hrl[0]}/${this.hrlB64.hrl[1]}`}
            >
              <div
                class="row"
                style="align-items: center; padding: 0; margin: 0;"
                title=${this.selectTitle ? this.selectTitle : msg('Click to select')}
                tabindex="0"
                @click=${() => this.handleClick()}
                @keypress.enter=${() => this.handleClick()}
              >
                <div class="row icon-container">
                  <sl-icon
                    style="height: 30px; width: 30px; border-radius: 5px 0 0 5px;"
                    .src=${this.entryInfo.value.value.icon_src}
                    alt="${this.entryInfo.value.value.name} entry type icon"
                  ></sl-icon>
                </div>
                <div class="row title-container">${this.entryInfo.value.value.name}</div>
              </div>
              <!-- <div class="row open">Open</div> -->
              <div
                class="row clear"
                title=${msg('Remove from clipboard.')}
                tabindex="0"
                @click=${() => {
                  this._weStore.removeHrlFromClipboard(this.hrlB64);
                  this.dispatchEvent(new CustomEvent('hrl-removed', {}));
                }}
              >
                X
              </div>
            </div>
          `;
        }
      default:
        return html`<div>Error</div>`;
    }
  }

  static styles = [
    weStyles,
    css`
      .element {
        flex: 1;
        align-items: center;
        background: #f5f5f5;
        border-radius: 8px;
        box-shadow: 0 0 5px black;
        cursor: pointer;
      }

      .element:hover {
        background: #e6eeff;
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
        padding: 0 8px;
        background: #e3ffdb;
        align-items: center;
        justify-content: center;
        height: 40px;
        cursor: pointer;
      }
      .open:hover {
        background: #b7eaab;
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

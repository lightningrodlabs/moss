import { LitElement, css, html } from 'lit';
import { state, property, customElement } from 'lit/decorators.js';
import { sharedStyles, wrapPathInSvg } from '@holochain-open-dev/elements';
import { localized } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/popup/popup.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import { WeaveClient } from '@theweave/api';
import { mdiMagnify, mdiPocket } from '@mdi/js';

/**
 * @element post-detail
 * @fires post-deleted: detail will contain { postHash }
 */
@localized()
@customElement('select-asset-menu')
export class SelectAssetMenu extends LitElement {
  @property({ attribute: 'weave-client' })
  weaveClient!: WeaveClient;

  @property()
  title: string = 'link asset';

  @property()
  placement:
    | 'top'
    | 'top-start'
    | 'top-end'
    | 'right'
    | 'right-start'
    | 'right-end'
    | 'bottom'
    | 'bottom-start'
    | 'bottom-end'
    | 'left'
    | 'left-start'
    | 'left-end' = 'top-start';

  @property()
  distance: number = 0;

  @property()
  skidding: number = 0;

  @property({ type: Boolean })
  flip = false;

  /**
   * @internal
   */
  @state()
  active = false;

  async firstUpdated() {}

  render() {
    return html`
      <!-- a backdrop to listen for side-clicks and close the menu -->
      ${this.active
        ? html`<div
            class="backdrop"
            @click=${() => {
              this.active = false;
            }}
          ></div>`
        : html``}

      <!-- the menu -->
      <sl-popup
        placement=${this.placement}
        strategy="fixed"
        shift
        ?flip=${this.flip}
        ?active=${this.active}
        skidding="${this.skidding}"
        distance="${this.distance}"
      >
        <span slot="anchor" style="margin: 0;">
          <slot
            @click=${() => {
              this.active = !this.active;
            }}
          ></slot>
        </span>

        <div class="column menu">
          <div class="title">${this.title}</div>
          <button
            class="btn"
            @click=${async () => {
              const maybeWal = await this.weaveClient.assets.userSelectAsset('search');
              if (!maybeWal) {
                // If the selection process got cancelled, hide the menu
                this.active = false;
                return;
              }
              this.dispatchEvent(
                new CustomEvent('wal-selected', {
                  detail: maybeWal,
                  bubbles: true,
                  composed: true,
                }),
              );
            }}
          >
            <div class="row" style="align-items: center;">
              <sl-icon style="font-size: 22px;" .src=${wrapPathInSvg(mdiMagnify)}></sl-icon>
              <span style="margin-left: 3px;">Search</span>
            </div>
          </button>
          <button
            class="btn"
            @click=${async () => {
              const maybeWal = await this.weaveClient.assets.userSelectAsset('pocket');
              if (!maybeWal) {
                // If the selection process got cancelled, hide the menu
                this.active = false;
                return;
              }
              this.dispatchEvent(
                new CustomEvent('wal-selected', {
                  detail: maybeWal,
                  bubbles: true,
                  composed: true,
                }),
              );
            }}
          >
            <div class="row" style="align-items: center;">
              <sl-icon style="font-size: 22px;" .src=${wrapPathInSvg(mdiPocket)}></sl-icon>
              <span style="margin-left: 3px;">From Pocket</span>
            </div>
          </button>
          <button
            class="btn"
            @click=${async () => {
              const maybeWal = await this.weaveClient.assets.userSelectAsset('create');
              if (!maybeWal) {
                // If the selection process got cancelled, hide the menu
                this.active = false;
                return;
              }
              this.dispatchEvent(
                new CustomEvent('wal-selected', {
                  detail: maybeWal,
                  bubbles: true,
                  composed: true,
                }),
              );
            }}
          >
            <div class="row" style="align-items: center;">
              <svg
                width="22"
                height="22"
                viewBox="0 0 32 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M19.999 2.00098V6.00077H21.9989V2.00098H19.999ZM15.3429 3.93057L13.9289 5.34461L16.7569 8.17257L18.171 6.75853L15.3429 3.93057ZM26.655 3.93057L23.827 6.75853L25.241 8.17257L28.069 5.34461L26.655 3.93057ZM20.8837 8.00072C20.0828 8.00072 19.282 8.30384 18.6768 8.90888L3.90784 23.6778C2.69739 24.8883 2.69739 26.8812 3.90784 28.0917C5.11829 29.3022 7.11128 29.3022 8.32173 28.0917L23.0907 13.3227C24.3011 12.1123 24.3011 10.1193 23.0907 8.90888C22.4855 8.30365 21.6846 8.00072 20.8837 8.00072ZM20.8837 9.98498C21.1673 9.98498 21.4509 10.0973 21.6767 10.3229C22.1281 10.7744 22.1281 11.4574 21.6767 11.9088L18.999 14.5864L17.4132 13.0005L20.0908 10.3229C20.3165 10.0973 20.6002 9.98498 20.8837 9.98498ZM25.9988 10.0001V12H29.9986V10.0001H25.9988ZM25.241 13.8281L23.827 15.2422L26.655 18.0701L28.069 16.6561L25.241 13.8281ZM15.9992 14.4141L17.585 15.9999L6.90772 26.6772C6.45625 27.1287 5.77331 27.1287 5.32185 26.6772C4.87037 26.2258 4.87038 25.5428 5.32185 25.0913L15.9992 14.4141Z"
                  fill="black"
                />
              </svg>
              <span style="margin-left: 3px;">Create New</span>
            </div>
          </button>
        </div>
      </sl-popup>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      .menu {
        background: #ffff;
        color: black;
        font-family: 'Inter Variable', 'Aileron', 'Open Sans', 'Helvetica Neue', sans-serif;
        border-radius: 5px;
        box-shadow: 0 0 3px 1px #ababab;
      }

      .title {
        text-align: right;
        font-size: 13px;
        padding: 2px 5px 2px 15px;
      }

      .btn {
        all: unset;
        cursor: pointer;
        padding: 5px 7px;
      }

      .btn:hover {
        background: #345d9c41;
      }

      .btn:focus-visible {
        background: #345d9c41;
      }

      .backdrop {
        display: flex;
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
        z-index: 989;
      }

      sl-popup::part(popup) {
        /* The z-index used by shoelace for tooltips is 1000 */
        z-index: 990;
      }
    `,
  ];
}

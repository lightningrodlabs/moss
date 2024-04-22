import { customElement, state, query } from 'lit/decorators.js';
import { css, html, LitElement } from 'lit';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { sharedStyles, wrapPathInSvg } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@lightningrodlabs/we-elements/dist/elements/we-client-context.js';

import '@shoelace-style/shoelace/dist/components/drawer/drawer.js';
import { SlDrawer } from '@shoelace-style/shoelace';
import { mossStoreContext } from '../context.js';
import { MossStore } from '../moss-store.js';
import { buildHeadlessWeClient } from '../applets/applet-host.js';
import './wal-element.js';
import './wal-created-element.js';
import { deStringifyWal } from '../utils.js';
import { WAL } from '@lightningrodlabs/we-applet';
import { mdiDelete } from '@mdi/js';


/**
 * @element search-entry
 * @fires entry-selected - Fired when the user selects some entry. Detail will have this shape: { hrl, context }
 */
@localized()
@customElement('moss-pocket')
export class MossPocket extends LitElement {
  @consume({ context: mossStoreContext })
  @state()
  _mossStore!: MossStore;

  @query('#pocket')
  _drawer!: SlDrawer;

  @state()
  mode: 'open' | 'select' = 'open';

  @state()
  pocketContent: Array<string> = [];

  @state()
  recentlyCreatedContent: Array<string> = [];

  show(mode: 'open' | 'select') {
    this.loadPocketContent();
    this.mode = mode;
    this._drawer.show();
    this.recentlyCreatedContent = this._mossStore.persistedStore.recentlyCreated.value().reverse();
  }

  hide() {
    this.mode = 'open';
    this._drawer.hide();
  }

  requestCreate() {
    this.dispatchEvent(
      new CustomEvent('open-creatable-panel', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  loadPocketContent() {
    this.pocketContent = this._mossStore.persistedStore.pocket.value();
  }

  clearPocket() {
    this._mossStore.clearPocket()
    this.pocketContent = [];
  }

  handleWalSelected(e: { detail: { wal: WAL }; target: { reset: () => void } }) {
    switch (this.mode) {
      case 'open':
        this.dispatchEvent(
          new CustomEvent('open-wal', {
            detail: e.detail,
            bubbles: true,
            composed: true,
          }),
        );
        break;
      case 'select':
        this.dispatchEvent(
          new CustomEvent('wal-selected', {
            detail: e.detail,
            bubbles: true,
            composed: true,
          }),
        );
        break;
    }
    try {
      // if the event target was the search bar
      e.target.reset();
    } catch (e) {
      // ignore
    }
    this.hide();
  }

  handleOpenWurl(e: { detail: { wurl: string }; target: { reset: () => void } }) {
    this.dispatchEvent(
      new CustomEvent('open-wurl', {
        detail: {
          wurl: e.detail.wurl,
        },
        bubbles: true,
        composed: true,
      }),
    );
    try {
      // if the event target was the search bar
      e.target.reset();
    } catch (e) {
      // ignore
    }
    this.hide();
  }

  walToPocket(wal: WAL) {
    console.log('Adding hrl to pocket: ', wal);
    this._mossStore.walToPocket(wal);
    this.loadPocketContent();
  }

  render() {
    return html`
      <sl-drawer
        placement="bottom" class="drawer-contained"
        id="pocket"
        contained
        @sl-hide=${(e: CustomEvent) => {
          // https://github.com/shoelace-style/shoelace/issues/1161
          // prevent sl-hide events from contained elements from bubbling since sl-hide is used to
          // cancel userSelectHrl
          if (e.target !== e.currentTarget) {
            e.stopPropagation();
          }
        }}
      >
        <div slot="label" style="display:flex;align-items:center;">
            <img src="pocket_black.png" style="height: 30px; margin-right: 10px;">
                ${msg('Pocket:')}
            <div style="display:inline-block;font-size:80%;color: var(--sl-color-secondary-950)">
              <span style="background: #e0e0e0; padding: 2px 5px; border-radius: 4px; color: black;"
                        >Alt + P</span>
              ${msg('to open')}
            </div>
          </div>
        </div>
        <sl-icon-button slot="header-actions"
          .src=${wrapPathInSvg(mdiDelete)}
                    @click=${() => this.clearPocket()}
        ></sl-icon-button>
        <div class="column" style="align-items: center; position: relative; padding-bottom: 30px;">
                  ${
            this.mode === 'select'
              ? html`<div style="font-size: 25px; margin-bottom: 30px;">
                  ${msg('Select Attachment:')}
                </div>`
              : html``
          }
          ${
            this.mode === 'select'
              ? html`
                  <sl-button
                    variant="primary"
                    style="margin-top: 10px;"
                    @click=${() => this.requestCreate()}
                  >
                    <div class="row" style="align-items: center;">
                      <img
                        src="magic_hat.svg"
                        style="height: 23px; margin-right: 3px; filter: invert(100%) sepia(0%) saturate(7482%) hue-rotate(211deg) brightness(99%) contrast(102%);"
                      />
                      <div>Create New</div>
                    </div>
                  </sl-button>
                `
              : html``
          }
          ${
            this.recentlyCreatedContent.length > 0
              ? html`
                  <div class="row" style="margin-top: 0px;  justify-content:center; flex-wrap: wrap; align-items:center">
                    <div class="row" style="margin-right:20px; font-size: 25px; align-items: center;">
                      <img
                        src="magic_hat.svg"
                        style="height: 35px; margin-right: 10px; margin-bottom: 10px;"
                      />
                      ${msg('Recently created:')}
                    </div>
                    ${this.recentlyCreatedContent.length > 0
                      ? this.recentlyCreatedContent.map(
                          (walStringified) => html`
                            <wal-created-element
                              .wal=${deStringifyWal(walStringified)}
                              .selectTitle=${this.mode === 'open' ? msg('Open') : undefined}
                              @added-to-pocket=${() => this.loadPocketContent()}
                              @wal-selected=${(e) => this.handleWalSelected(e)}
                              style="margin: 0 7px 7px 0;"
                            ></wal-created-element>
                          `,
                        )
                      : html`Nothing in your pocket. Watch out for pocket icons to add things to
                        your pocket.`}
                  </div>
                `
              : html``
          }
          <div class="row" style=" margin-top:10px; flex-wrap: wrap;">
            ${
              this.pocketContent.length > 0
                ? this.pocketContent.map(
                    (walStringified) => html`
                      <wal-element
                        .wal=${deStringifyWal(walStringified)}
                        .selectTitle=${this.mode === 'open' ? msg('Open') : undefined}
                        @wal-removed=${() => this.loadPocketContent()}
                        @wal-selected=${(e) => this.handleWalSelected(e)}
                        style="margin: 0 7px 7px 0;"
                      ></wal-element>
                    `,
                  )
                : html`Nothing in your pocket. Watch out for pocket icons to add things to your
                  pocket.`
            }
          </div>
      </sl-drawer>
    `;
  }

  static get styles() {
    return [
      sharedStyles,
      css`
        :host {
          display: flex;
        }

        sl-dialog {
          --sl-panel-background-color: var(--sl-color-tertiary-0);
        }
      `,
    ];
  }
}

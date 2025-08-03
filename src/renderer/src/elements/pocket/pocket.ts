import { customElement, state, query } from 'lit/decorators.js';
import { css, html, LitElement } from 'lit';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { sharedStyles, wrapPathInSvg } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@theweave/elements/dist/elements/weave-client-context.js';

import { EntryHash } from '@holochain/client';
import { DnaHash } from '@holochain/client';
import { AppletInfo, AssetLocationAndInfo, GroupProfile, WAL, deStringifyWal } from '@theweave/api';
import { SlDialog } from '@shoelace-style/shoelace';
import { mossStoreContext } from '../../context.js';
import { MossStore, WalInPocket } from '../../moss-store.js';
import { buildHeadlessWeaveClient } from '../../applets/applet-host.js';
import './wal-element.js';
import './wal-created-element.js';
import './pocket-search.js';
import { PocketSearch } from './pocket-search.js';
import { mdiDelete } from '@mdi/js';
import { mossStyles } from '../../shared-styles.js';

export interface SearchResult {
  hrlsWithInfo: Array<[WAL, AssetLocationAndInfo]>;
  groupsProfiles: ReadonlyMap<DnaHash, GroupProfile>;
  appletsInfos: ReadonlyMap<EntryHash, AppletInfo>;
}

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

  @query('#pocket-dialog')
  _dialog!: SlDialog;

  @query('#pocket-search')
  _searchField!: PocketSearch;

  @state()
  mode: 'open' | 'select' = 'open';

  @state()
  pocketContent: Array<WalInPocket> = [];

  @state()
  recentlyCreatedContent: Array<string> = [];

  show(mode: 'open' | 'select') {
    this.loadPocketContent();
    this.mode = mode;
    this._dialog.show();
    this._searchField.focus();
    this.recentlyCreatedContent = this._mossStore.persistedStore.recentlyCreated.value().reverse();
  }

  hide() {
    this.mode = 'open';
    this._dialog.hide();
  }

  requestCreate() {
    this.dispatchEvent(
      new CustomEvent('open-creatable-palette', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  loadPocketContent() {
    this.pocketContent = this._mossStore.persistedStore.pocket.value();
  }

  clearPocket() {
    this._mossStore.clearPocket();
    this.pocketContent = [];
  }

  removeWalFromPocket(wal: WAL) {
    this._mossStore.removeWalFromPocket(wal);
    this.loadPocketContent();
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
      <sl-dialog
        class="moss-dialog"
        id="pocket-dialog"
        style="--width: 800px;"
        no-header
        @sl-initial-focus=${(e: { preventDefault: () => void }) => {
          e.preventDefault();
          this._searchField.focus();
        }}
        @sl-hide=${(e: CustomEvent) => {
          // https://github.com/shoelace-style/shoelace/issues/1161
          // prevent sl-hide events from contained elements from bubbling since sl-hide is used to
          // cancel userSelectHrl
          if (e.target !== e.currentTarget) {
            e.stopPropagation();
          }
        }}
      >
        <div class="column" style="align-items: center; position: relative; padding-bottom: 30px;">
          ${
            this.pocketContent.length > 0
              ? html`
                  <div style="position: absolute; bottom: -10px; left: -10px; ">
                    <sl-button
                      class="clear-pocket"
                      variant="text"
                      size="small"
                      @click=${() => this.clearPocket()}
                      ><sl-icon slot="prefix" .src=${wrapPathInSvg(mdiDelete)}></sl-icon> Clear
                      Pocket</sl-button
                    >
                  </div>
                `
              : ``
          }

          ${
            this.mode === 'select'
              ? html`<div style="font-size: 25px; margin-bottom: 30px;">
                  ${msg('Select Attachment:')}
                </div>`
              : html``
          }
          ${
            this.mode === 'open'
              ? html`<div
                  style="position: absolute; bottom: -10px; right: -10px; color: var(--sl-color-secondary-950);"
                >
                  <span
                    style="background: #e0e0e0; padding: 2px 5px; border-radius: 4px; color: black;"
                    >Alt + S</span
                  >
                  to open Clipboard
                </div>`
              : html``
          }

          <weave-client-context
            .weaveClient=${buildHeadlessWeaveClient(this._mossStore)}
          >
            <pocket-search
              id="pocket-search"
              field-label=""
              .mode=${this.mode}
              @entry-selected=${(e) => this.handleWalSelected(e)}
              @wal-to-pocket=${(e) => this.walToPocket(e.detail.wal)}
              @open-wurl=${(e) => this.handleOpenWurl(e)}
            ></pocket-search>
          </weave-client-context>
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
                        src="magic-wand.svg"
                        style="color: white; height: 20px; margin-right: 4px;"
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
                  <div class="row" style="font-size: 25px; margin-top: 30px; align-items: center;">
                    <img
                      src="magic-wand.svg"
                      style="height: 45px; margin-right: 10px; margin-bottom: 10px;"
                    />
                    ${msg('Recently created:')}
                  </div>
                  <div class="row" style="margin-top: 30px; flex-wrap: wrap;">
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
          <div class="row" style="font-size: 25px; margin-top: 30px; align-items: center;">
            <img src="pocket_black.png" style="height: 38px; margin-right: 10px;">
            ${msg('In Your Pocket:')}
          </div>
          <div class="row" style="margin-top: 30px; flex-wrap: wrap;">
            ${
              this.pocketContent.length > 0
                ? this.pocketContent
                    .sort((wal_a, wal_b) => wal_b.addedAt - wal_a.addedAt)
                    .map(
                      (walInPocket) => html`
                        <wal-element
                          .wal=${deStringifyWal(walInPocket.wal)}
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
      </sl-dialog>
    `;
  }

  static get styles() {
    return [
      mossStyles,
      sharedStyles,
      css`
        :host {
          display: flex;
        }

        sl-button.clear-pocket::part(base) {
          color: var(--sl-color-primary-600);
        }

        sl-button.clear-pocket::part(base):hover {
          color: var(--sl-color-primary-900);
        }
      `,
    ];
  }
}

import { customElement, state, query, property } from 'lit/decorators.js';
import { css, html, LitElement } from 'lit';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { wrapPathInSvg } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@theweave/elements/dist/elements/weave-client-context.js';

import { EntryHash } from '@holochain/client';
import { DnaHash } from '@holochain/client';
import { AppletInfo, AssetLocationAndInfo, GroupProfile, WAL } from '@theweave/api';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { buildHeadlessWeaveClient } from '../../applets/applet-host.js';
import './wal-element.js';
import './wal-created-element.js';
import './pocket-search.js';
import { PocketSearch } from './pocket-search.js';
import { deStringifyWal } from '../../utils.js';
import { mdiArrowDownBoldBoxOutline, mdiDelete } from '@mdi/js';
import { weStyles } from '../../shared-styles.js';
import { get } from '@holochain-open-dev/stores';

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
@customElement('overlay-pocket')
export class OverlayPocket extends LitElement {
  @consume({ context: mossStoreContext })
  @state()
  _mossStore!: MossStore;

  @query('#pocket-search')
  _searchField!: PocketSearch;

  @property({ type: Boolean })
  hoverArea = true;

  @state()
  hovering = false;

  @state()
  mode: 'open' | 'select' = 'open';

  @state()
  pocketContent: Array<string> = [];

  @state()
  recentlyCreatedContent: Array<string> = [];

  // https://stackoverflow.com/questions/7110353/html5-dragleave-fired-when-hovering-a-child-element
  @state()
  dragCounter = 0;

  requestCreate() {
    this.dispatchEvent(
      new CustomEvent('open-creatable-panel', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  firstUpdated() {
    this.loadPocketContent();
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
  }

  walToPocket(wal: WAL) {
    console.log('Adding hrl to pocket: ', wal);
    this._mossStore.walToPocket(wal);
    this.loadPocketContent();
  }

  handleDrop = () => {
    console.log('## DROP COMPLETING.');
    const wal = get(this._mossStore.draggedWal());
    if (wal) {
      this.walToPocket(wal);
      this.loadPocketContent();
      setTimeout(() => {
        this._mossStore.clearDraggedWal();
        this.dispatchEvent(
          new CustomEvent('wal-dropped', {
            composed: true,
          }),
        );
      }, 5000);
    }
  };

  handleDropCancel = () => {
    console.log('## DROP CANCELLED.');
    this._mossStore.clearDraggedWal();
    this.dispatchEvent(
      new CustomEvent('wal-dropped', {
        composed: true,
      }),
    );
  };

  render() {
    return html`
      <div
        class="column flex-1"
        style="align-items: center; position: relative; color: white;"
        @dragover=${(e: DragEvent) => {
          e.preventDefault();
        }}
        @drop=${this.handleDropCancel}
      >
        <!-- Search bar -->
        <div style="margin-top: 22vh;">
          ${this.mode === 'select'
            ? html`<div style="font-size: 25px; margin-bottom: 30px;">
                ${msg('Select Attachment:')}
              </div>`
            : html``}

          <weave-client-context .weaveClient=${buildHeadlessWeaveClient(this._mossStore)}>
            <pocket-search
              id="pocket-search"
              field-label=""
              .mode=${this.mode}
              @entry-selected=${(e) => this.handleWalSelected(e)}
              @wal-to-pocket=${(e) => this.walToPocket(e.detail.wal)}
              @open-wurl=${(e) => this.handleOpenWurl(e)}
            ></pocket-search>
          </weave-client-context>
          ${this.mode === 'select'
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
            : html``}
        </div>

        <div class="flex flex-1"></div>

        <!-- Pocket Content -->
        <div class="column items-center" style="min-height: 40vh; width: 100vw;">
          ${this.recentlyCreatedContent.length > 0
            ? html`
                <div class="row" style="font-size: 25px; margin-top: 30px; align-items: center;">
                  <img
                    src="magic_hat.svg"
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
                    : html`Nothing in your pocket. Watch out for pocket icons to add things to your
                      pocket.`}
                </div>
              `
            : html``}
          <div
            class="row"
            style="color: white; font-size: 25px; margin-top: 30px; align-items: center;"
          >
            <img
              src="pocket_black.png"
              style="height: 38px; margin-right: 10px; filter: invert(100%);"
            />
            ${msg('In Your Pocket:')}
          </div>
          <div
            class="column flex-1 items-center justify-center ${this.hoverArea
              ? 'hover-area'
              : ''} ${this.hovering ? 'hovering' : ''}"
            style="position: relative; width: 100%; margin-top: 20px;"
            @dragover=${(e: DragEvent) => {
              e.preventDefault();
            }}
            @drop=${this.handleDrop}
            @dragenter=${() => {
              this.dragCounter++;
              this.hovering = true;
            }}
            @dragleave=${() => {
              this.dragCounter--;
              if (this.dragCounter === 0) {
                this.hovering = false;
              }
            }}
          >
            ${this.hoverArea
              ? html` <div
                  class="flex flex-1"
                  style="position: absolute; top: 0; bottom: 0; left: 0; right: 0;"
                >
                  <div
                    class="column center-content flex-1"
                    style="opacity: 0.4; margin: 35px; border-radius: 50px; border: 3px dashed white;"
                  >
                    <div class="row items-center">
                      <sl-icon
                        style="font-size: 125px;"
                        src=${wrapPathInSvg(mdiArrowDownBoldBoxOutline)}
                      ></sl-icon>
                      <span style="margin-left: 20px; font-size: 60px;">
                        drop to add to pocket</span
                      >
                    </div>
                  </div>
                </div>`
              : html``}

            <div class="row flex-1" style="margin-top: 20px; flex-wrap: wrap; z-index: 0;">
              ${this.pocketContent.length > 0
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
                : html`<div style="font-size: 20px; ${this.hoverArea ? 'display: none;' : ''}">
                    Nothing in your pocket. Watch out for pocket icons to add assets to your pocket.
                  </div>`}
            </div>
          </div>
        </div>
      </div>

      <!-- Clear Pocket button -->
      ${this.pocketContent.length > 0
        ? html`
            <sl-button
              class="clear-pocket"
              variant="text"
              size="large"
              style="position: absolute; bottom: 0px; left: 0px; --sl-color-primary-600: white; --sl-color-primary-900: red;"
              @click=${() => this.clearPocket()}
            >
              <div class="row items-center">
                <sl-icon
                  style="font-size: 30px;"
                  slot="prefix"
                  .src=${wrapPathInSvg(mdiDelete)}
                ></sl-icon>
                <span style="margin-left: 5px;">Clear Pocket</span>
              </div>
            </sl-button>
          `
        : ``}
    `;
  }

  static get styles() {
    return [
      weStyles,
      css`
        :host {
          display: flex;
        }

        .hover-area {
          background: #87d11a4f;
        }

        .hovering {
          background: #d3f37479;
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

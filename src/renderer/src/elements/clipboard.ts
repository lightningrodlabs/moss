import { customElement, state, query } from 'lit/decorators.js';
import { css, html, LitElement } from 'lit';
import { consume } from '@lit-labs/context';
import { localized, msg } from '@lit/localize';
import { sharedStyles } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@lightningrodlabs/we-applet/dist/elements/we-client-context.js';

import { EntryHash } from '@holochain/client';
import { DnaHash } from '@holochain/client';
import {
  AppletInfo,
  EntryLocationAndInfo,
  GroupProfile,
  HrlB64WithContext,
  HrlWithContext,
} from '@lightningrodlabs/we-applet';
import { SlDialog } from '@shoelace-style/shoelace';
import { weStoreContext } from '../context.js';
import { WeStore } from '../we-store.js';
import { buildHeadlessWeClient } from '../applets/applet-host.js';
import './hrl-element.js';
import './clipboard-search.js';
import { ClipboardSearch } from './clipboard-search.js';

export interface SearchResult {
  hrlsWithInfo: Array<[HrlWithContext, EntryLocationAndInfo]>;
  groupsProfiles: ReadonlyMap<DnaHash, GroupProfile>;
  appletsInfos: ReadonlyMap<EntryHash, AppletInfo>;
}

/**
 * @element search-entry
 * @fires entry-selected - Fired when the user selects some entry. Detail will have this shape: { hrl, context }
 */
@localized()
@customElement('we-clipboard')
export class WeClipboard extends LitElement {
  @consume({ context: weStoreContext })
  @state()
  _weStore!: WeStore;

  @query('#clipboard-dialog')
  _dialog!: SlDialog;

  @query('#clipboard-search')
  _searchField!: ClipboardSearch;

  @state()
  mode: 'open' | 'select' = 'open';

  @state()
  clipboardContent: Array<HrlB64WithContext> = [];

  show(mode: 'open' | 'select') {
    this.loadClipboardContent();
    this.mode = mode;
    this._dialog.show();
    this._searchField.focus();
  }

  hide() {
    this.mode = 'open';
    this._dialog.hide();
  }

  loadClipboardContent() {
    const clipboardJSON: string | null = window.localStorage.getItem('clipboard');
    let clipboardContent: Array<HrlB64WithContext> = [];
    if (clipboardJSON) {
      clipboardContent = JSON.parse(clipboardJSON);
    }
    this.clipboardContent = clipboardContent;
  }

  removeHrlFromClipboard(hrlB64: HrlB64WithContext) {
    this._weStore.removeHrlFromClipboard(hrlB64);
    this.loadClipboardContent();
  }

  handleHrlSelected(e: {
    detail: { hrlWithContext: HrlWithContext };
    target: { reset: () => void };
  }) {
    switch (this.mode) {
      case 'open':
        this.dispatchEvent(
          new CustomEvent('open-hrl', {
            detail: e.detail,
            bubbles: true,
            composed: true,
          }),
        );
        break;
      case 'select':
        this.dispatchEvent(
          new CustomEvent('hrl-selected', {
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

  hrlToClipboard(hrlWithContext: HrlWithContext) {
    console.log('Adding hrl to clipboard: ', hrlWithContext);
    this._weStore.hrlToClipboard(hrlWithContext);
    this.loadClipboardContent();
  }

  render() {
    return html`
      <sl-dialog
        id="clipboard-dialog"
        style="--width: 800px;"
        no-header
        @sl-initial-focus=${(e: { preventDefault: () => void }) => {
          e.preventDefault();
          this._searchField.focus();
        }}
      >
        <div class="column" style="align-items: center; position: relative; padding-bottom: 30px;">
          ${
            this.mode === 'select'
              ? html`<div style="font-size: 25px; margin-bottom: 30px;">
                  ${msg('Select Attachment:')}
                </div>`
              : html`<div style="font-size: 25px; margin-bottom: 30px;">
                  ${msg('Your Clipboard')}
                </div>`
          }
          ${
            this.mode === 'open'
              ? html`<div style="position: absolute; bottom: -10px; right: -10px; color: gray;">
                  <span
                    style="background: #e0e0e0; padding: 2px 5px; border-radius: 4px; color: black;"
                    >Alt + S</span
                  >
                  to open Clipboard
                </div>`
              : html``
          }

          <we-client-context
            .weClient=${buildHeadlessWeClient(this._weStore)}
          >
            <clipboard-search
              id="clipboard-search"
              field-label=""
              @entry-selected=${(e) => this.handleHrlSelected(e)}
              @hrl-to-clipboard=${(e) => this.hrlToClipboard(e.detail.hrlWithContext)}
            ></clipboard-search>
          </we-client-context>

          <div class="row" style="margin-top: 30px; flex-wrap: wrap;">
            ${this.clipboardContent.map(
              (hrlB64) => html`
                <hrl-element
                  .hrlB64=${hrlB64}
                  .selectTitle=${this.mode === 'open' ? msg('Click to open') : undefined}
                  @hrl-removed=${() => this.loadClipboardContent()}
                  @hrl-selected=${(e) => this.handleHrlSelected(e)}
                  style="margin: 0 7px 7px 0;"
                ></hrl-element>
              `,
            )}
          </div>
      </sl-dialog>
    `;
  }

  static get styles() {
    return [
      sharedStyles,
      css`
        :host {
          display: flex;
        }
      `,
    ];
  }
}

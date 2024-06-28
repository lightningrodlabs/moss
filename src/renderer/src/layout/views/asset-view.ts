import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { msg } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { notify, notifyError, wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiHomeImportOutline, mdiOpenInNew, mdiShareVariantOutline } from '@mdi/js';

import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@lightningrodlabs/we-elements/dist/elements/share-wal.js';
import '@lightningrodlabs/we-elements/dist/elements/weave-client-context.js';

import { encodeContext, WAL } from '@lightningrodlabs/we-applet';

import { mossStoreContext } from '../../context.js';
import { DnaLocation, EntryDefLocation } from '../../processes/hrl/locate-hrl.js';
import { weStyles } from '../../shared-styles.js';
import { MossStore } from '../../moss-store.js';
import './applet-view.js';
import '../../elements/wal-pocket.js';
import { buildHeadlessWeaveClient } from '../../applets/applet-host.js';
import { openWalInWindow } from '../../utils.js';
import { encodeHashToBase64 } from '@holochain/client';

@customElement('asset-view')
export class AssetView extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  /**
   * REQUIRED. The Hrl of the entry to render
   */
  @property()
  wal!: WAL;

  location = new StoreSubscriber(
    this,
    () => this._mossStore.hrlLocations.get(this.wal.hrl[0]).get(this.wal.hrl[1]),
    () => [this.wal],
  );

  jumpToApplet() {
    if (this.location.value.status !== 'complete' || this.location.value.value === undefined) {
      console.error('Asset location not defined (yet).');
      notifyError('Failed to jump to Tool (see console for details).');
    } else {
      this.dispatchEvent(
        new CustomEvent('jump-to-applet', {
          detail: this.location.value.value.dnaLocation.appletHash,
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  async openInWindow() {
    if (this.location.value.status !== 'complete' || this.location.value.value === undefined) {
      console.error('Asset location not defined (yet).');
      notifyError('Failed to open Asset in window (see console for details).');
    } else {
      const appletHash = this.location.value.value.dnaLocation.appletHash;
      return openWalInWindow(this.wal, encodeHashToBase64(appletHash), this._mossStore);
    }
  }

  async copyWal() {
    let url = `weave-0.13://hrl/${encodeHashToBase64(this.wal.hrl[0])}/${encodeHashToBase64(
      this.wal.hrl[1],
    )}`;
    if (this.wal.context) {
      url = `${url}?context=${encodeContext(this.wal.context)}`;
    }
    await navigator.clipboard.writeText(url);

    notify(msg('URL copied to clipboard.'));
  }

  renderGroupView(dnaLocation: DnaLocation, entryTypeLocation?: EntryDefLocation) {
    return html`<applet-view
        style="flex: 1"
        .appletHash=${dnaLocation.appletHash}
        .hostColor=${'#dde7ff'}
        .view=${{
          type: 'asset',
          wal: this.wal,
          recordInfo: entryTypeLocation
            ? {
                roleName: dnaLocation.roleName,
                integrityZomeName: entryTypeLocation.integrity_zome,
                entryType: entryTypeLocation.entry_def,
              }
            : undefined,
        }}
      ></applet-view>
      <div id="we-toolbar" class="column toolbar">
        <weave-client-context .weaveClient=${buildHeadlessWeaveClient(this._mossStore)}>
          <sl-tooltip content="Open in Window">
            <div
              class="row btn toolbar-btn"
              style="font-size: 28px"
              tabindex="0"
              @click=${() => this.openInWindow()}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  this.openInWindow();
                }
              }}
            >
              <sl-icon .src=${wrapPathInSvg(mdiOpenInNew)}></sl-icon>
            </div>
          </sl-tooltip>
          <sl-tooltip content="Jump to parent Tool">
            <div
              class="row btn toolbar-btn"
              tabindex="0"
              @click=${() => this.jumpToApplet()}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  this.jumpToApplet();
                }
              }}
            >
              <sl-icon .src=${wrapPathInSvg(mdiHomeImportOutline)}></sl-icon>
            </div>
          </sl-tooltip>
          <sl-tooltip content="Add to Pocket">
            <div
              class="row btn toolbar-btn"
              tabindex="0"
              @click=${() => this._mossStore.walToPocket(this.wal)}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  this._mossStore.walToPocket(this.wal);
                }
              }}
            >
              <img src="pocket_white.png" style="height: 35px; fill-color: white;" />
            </div>
          </sl-tooltip>
          <sl-tooltip .content=${msg('Share')}>
            <div
              class="row btn toolbar-btn"
              tabindex="0"
              @click=${() => this.copyWal()}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  this.copyWal();
                }
              }}
            >
              <sl-icon
                .src=${wrapPathInSvg(mdiShareVariantOutline)}
                style="padding-right: 10%;"
              ></sl-icon>
            </div>
          </sl-tooltip>
        </weave-client-context>
      </div> `;
  }

  render() {
    switch (this.location.value.status) {
      case 'pending':
        return html`<div class="row center-content" style="flex: 1">
          <sl-spinner style="font-size: 2rem"></sl-spinner>
        </div>`;
      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching the entry')}
          .error=${this.location.value.error}
        ></display-error>`;
      case 'complete':
        if (this.location.value.value === undefined)
          return html`<span>${msg('Asset not found.')}</span>`;

        return this.renderGroupView(
          this.location.value.value.dnaLocation,
          this.location.value.value.entryDefLocation,
        );
    }
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex: 1;
      }

      .btn {
        align-items: center;
        justify-content: center;
        background: var(--bg-color, white);
        padding: 9px;
        border-radius: 50%;
        box-shadow: 1px 1px 3px #6b6b6b;
        cursor: pointer;
      }

      .btn:hover {
        background: var(--bg-color-hover, #e4e4e4);
      }

      .toolbar {
        position: absolute;
        bottom: 30px;
        right: 0;
        background: red;
        padding: 10px;
        border-radius: 20px 0 0 20px;
        background: #97b6ff5e;
        /* background: #a9ea03a2; */
        box-shadow: 0 0 6px #97b6ff5e;
        /* background: #eacbff83;
        box-shadow: 0 0 6px #5804a8; */
      }

      .toolbar-btn {
        font-size: 36px;
        --bg-color: var(--sl-color-tertiary-900);
        --bg-color-hover: var(--sl-color-tertiary-700);
        /* --bg-color: #142510;
        --bg-color-hover: #3a622d; */
        color: white;
        margin: 3px 0;
        height: 34px;
        width: 34px;
      }
    `,
    weStyles,
  ];
}

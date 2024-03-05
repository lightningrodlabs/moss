import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { encodeHashToBase64 } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import { AttachableInfo, HrlWithContext } from '@lightningrodlabs/we-applet';

import { WeStore } from '../../we-store.js';
import { weStoreContext } from '../../context.js';
import { weStyles } from '../../shared-styles.js';
import { stringifyHrlWithContext } from '../../utils.js';

@customElement('entry-title')
export class EntryTitle extends LitElement {
  @consume({ context: weStoreContext, subscribe: true })
  _weStore!: WeStore;

  /**
   * REQUIRED. The Hrl of the entry to render
   */
  @property()
  hrlWithContext!: HrlWithContext;

  attachableInfo = new StoreSubscriber(
    this,
    () => this._weStore.attachableInfo.get(stringifyHrlWithContext(this.hrlWithContext)),
    () => [this.hrlWithContext],
  );

  renderName(info: AttachableInfo | undefined) {
    if (!info) return html`[Unknown]`;

    return html`
      <div class="row" style="align-items: center;">
        <div>
          <sl-icon
            .src=${info.icon_src}
            style="display: flex; margin-top: 2px; margin-right: 4px; font-size: 20px;"
          ></sl-icon>
        </div>
        <div
          class="column"
          title="${info.name}"
          style="color: black; overflow: hidden; height: 26px; max-width: 145px; margin-top: 10px;"
        >
          ${info.name}
        </div>
      </div>
    `;
  }

  render() {
    switch (this.attachableInfo.value.status) {
      case 'pending':
        return html``;
      case 'complete':
        return this.renderName(this.attachableInfo.value.value);
      case 'error':
        console.error(
          `Failed to get attachable info for HRL '${this.hrlWithContext.hrl.map((hash) =>
            encodeHashToBase64(hash),
          )} and context ${JSON.stringify(this.hrlWithContext.context)}': ${
            this.attachableInfo.value.error
          }`,
        );
        return html`[Unknown]`;
    }
  }

  static styles = [
    weStyles,
    css`
      :host {
        display: flex;
      }
    `,
  ];
}

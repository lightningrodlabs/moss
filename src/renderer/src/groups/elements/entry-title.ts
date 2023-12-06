import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { encodeHashToBase64 } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import { EntryInfo, Hrl } from '@lightningrodlabs/we-applet';

import { WeStore } from '../../we-store.js';
import { weStoreContext } from '../../context.js';
import { weStyles } from '../../shared-styles.js';

@customElement('entry-title')
export class EntryTitle extends LitElement {
  @consume({ context: weStoreContext, subscribe: true })
  _weStore!: WeStore;

  /**
   * REQUIRED. The Hrl of the entry to render
   */
  @property()
  hrl!: Hrl;

  /**
   * REQUIRED. The context necessary to render this Hrl
   */
  @property()
  context!: any;

  entryInfo = new StoreSubscriber(
    this,
    () => this._weStore.entryInfo.get(this.hrl[0]).get(this.hrl[1]),
    () => [this.hrl],
  );

  renderName(info: EntryInfo | undefined) {
    if (!info) return html`[Unknown]`;

    return html` <sl-icon
        .src=${info.icon_src}
        style="display: flex; margin-top: 2px; margin-right: 4px"
      ></sl-icon>
      <span style="color: rgb(119,119,119)">${info.name}</span>`;
  }

  render() {
    switch (this.entryInfo.value.status) {
      case 'pending':
        return html``;
      case 'complete':
        return this.renderName(this.entryInfo.value.value);
      case 'error':
        console.error(
          `Failed to get entry info for HRL '${this.hrl.map((hash) =>
            encodeHashToBase64(hash),
          )}': ${this.entryInfo.value.error}`,
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

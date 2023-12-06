import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { ActionHash } from '@holochain/client';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { sharedStyles } from '@holochain-open-dev/elements';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import './custom-view-summary.js';
import { CustomViewsStore } from '../custom-views-store.js';
import { customViewsStoreContext } from '../context.js';

/**
 * @element all-custom-views
 */
@localized()
@customElement('all-custom-views')
export class AllCustomViews extends LitElement {
  /**
   * @internal
   */
  @consume({ context: customViewsStoreContext, subscribe: true })
  customViewsStore!: CustomViewsStore;

  /**
   * @internal
   */
  _allCustomViews = new StoreSubscriber(
    this,
    () => this.customViewsStore.allCustomViews,
    () => [],
  );

  renderList(hashes: Array<ActionHash>) {
    if (hashes.length === 0) return html``;

    return html`
      <div style="display: flex; flex-direction: column; flex: 1">
        ${hashes.map(
          (hash) =>
            html`<custom-view-summary
              .customViewHash=${hash}
              style="margin-bottom: 16px;"
            ></custom-view-summary>`,
        )}
      </div>
    `;
  }

  render() {
    switch (this._allCustomViews.value.status) {
      case 'pending':
        return html`<div
          style="display: flex; flex: 1; align-items: center; justify-content: center"
        >
          <sl-spinner style="font-size: 2rem;"></sl-spinner>
        </div>`;
      case 'complete':
        return this.renderList(this._allCustomViews.value.value);
      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching the custom views')}
          .error=${this._allCustomViews.value.error}
        ></display-error>`;
    }
  }

  static styles = [sharedStyles];
}

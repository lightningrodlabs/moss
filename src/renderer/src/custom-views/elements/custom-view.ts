import { LitElement, html, css } from 'lit';
import { property, customElement } from 'lit/decorators.js';
import { ActionHash } from '@holochain/client';
import { EntryRecord } from '@holochain-open-dev/utils';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { sharedStyles, hashProperty } from '@holochain-open-dev/elements';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';
import './edit-custom-view.js';

import { CustomViewsStore } from '../custom-views-store.js';
import { customViewsStoreContext } from '../context.js';
import { CustomView } from '../types.js';

/**
 * @element custom-view-detail
 * @fires custom-view-deleted: detail will contain { customViewHash }
 */
@localized()
@customElement('custom-view')
export class CustomViewEl extends LitElement {
  // REQUIRED. The hash of the CustomView to show
  @property(hashProperty('custom-view-hash'))
  customViewHash!: ActionHash;

  /**
   * @internal
   */
  @consume({ context: customViewsStoreContext, subscribe: true })
  customViewsStore!: CustomViewsStore;

  /**
   * @internal
   */
  _customView = new StoreSubscriber(
    this,
    () => this.customViewsStore.customViews.get(this.customViewHash)!,
    () => [this.customViewHash],
  );

  renderDetail(entryRecord: EntryRecord<CustomView>) {
    return html`
      <iframe
        title="applet-view"
        srcdoc="&lt;head&gt;&lt;style&gt;${entryRecord.entry
          .css}&lt;/style&gt;&lt;/head&gt;${entryRecord.entry.html}"
        style="flex: 1"
      ></iframe>
    `;
  }

  render() {
    switch (this._customView.value.status) {
      case 'pending':
        return html`<sl-card>
          <div style="display: flex; flex: 1; align-items: center; justify-content: center">
            <sl-spinner style="font-size: 2rem;"></sl-spinner>
          </div>
        </sl-card>`;
      case 'complete':
        const customView = this._customView.value.value;

        if (!customView)
          return html`<span>${msg("The requested custom view doesn't exist")}</span>`;

        return this.renderDetail(customView);
      case 'error':
        return html`<sl-card>
          <display-error
            .headline=${msg('Error fetching the custom view')}
            .error=${this._customView.value.error}
          ></display-error>
        </sl-card>`;
    }
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
      }
    `,
  ];
}

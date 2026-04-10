import { LitElement, html } from 'lit';
import { property, customElement } from 'lit/decorators.js';
import { ActionHash } from '@holochain/client';
import { EntryRecord } from '@holochain-open-dev/utils';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import {
  hashProperty,
  notifyError,
  sharedStyles,
  wrapPathInSvg,
} from '@holochain-open-dev/elements';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { mdiDelete, mdiPencil } from '@mdi/js';

import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

import { CustomViewsStore } from '../custom-views-store.js';
import { customViewsStoreContext } from '../context.js';
import { CustomView } from '../types.js';

/**
 * @element custom-view-summary
 * @fires custom-view-selected: detail will contain { customViewHash }
 */
@localized()
@customElement('custom-view-summary')
export class CustomViewSummary extends LitElement {
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

  async deleteCustomView() {
    try {
      await this.customViewsStore.client.deleteCustomView(this.customViewHash);

      this.dispatchEvent(
        new CustomEvent('custom-view-deleted', {
          bubbles: true,
          composed: true,
          detail: {
            customViewHash: this.customViewHash,
          },
        }),
      );
    } catch (e: any) {
      notifyError(msg('Error deleting the custom view'));
      console.error(e);
    }
  }

  renderDeleteDialog() {
    return html`
      <sl-dialog .label=${msg('Delete Custom View')} id="delete-dialog">
        <span>${msg('Are you sure you want to delete this custom view?')}</span>
        <sl-button slot="footer" variant="primary" @click=${() => this.deleteCustomView()}
          >${msg('Delete')}</sl-button
        >
      </sl-dialog>
    `;
  }

  renderSummary(entryRecord: EntryRecord<CustomView>) {
    return html`
      ${this.renderDeleteDialog()}
      <div class="row" style="align-items: center; flex: 1">
        <img
          style="width: 48px; height: 48px; border-radius: 8px; margin-right: 16px"
          src="${entryRecord.entry.logo}"
          alt="${entryRecord.entry.name}"
        />
        <span style="flex: 1">${entryRecord.entry.name}</span>

        <sl-tooltip .content=${msg('Edit')}>
          <sl-icon-button
            .src=${wrapPathInSvg(mdiPencil)}
            style="font-size: 2rem"
            @click=${(_e) => {
              this.dispatchEvent(
                new CustomEvent('edit-custom-view', {
                  bubbles: true,
                  composed: true,
                  detail: {
                    customViewHash: this.customViewHash,
                  },
                }),
              );
            }}
          ></sl-icon-button>
        </sl-tooltip>

        <sl-tooltip .content=${msg('Delete')}>
          <sl-icon-button
            .src=${wrapPathInSvg(mdiDelete)}
            style="font-size: 2rem"
            @click=${(_e) => {
              (this.shadowRoot?.getElementById('delete-dialog') as SlDialog).show();
            }}
          ></sl-icon-button>
        </sl-tooltip>
      </div>
    `;
  }

  renderCustomView() {
    switch (this._customView.value.status) {
      case 'pending':
        return html`<div
          style="display: flex; flex: 1; align-items: center; justify-content: center"
        >
          <sl-spinner style="font-size: 2rem;"></sl-spinner>
        </div>`;
      case 'complete':
        if (!this._customView.value.value)
          return html`<span>${msg("The requested custom view doesn't exist")}</span>`;

        return this.renderSummary(this._customView.value.value);
      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching the custom view')}
          .error=${this._customView.value.error}
        ></display-error>`;
    }
  }

  render() {
    return html`<sl-card style="flex: 1; "> ${this.renderCustomView()} </sl-card>`;
  }

  static styles = [sharedStyles];
}

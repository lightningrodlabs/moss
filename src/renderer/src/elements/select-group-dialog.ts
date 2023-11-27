import { DnaHashB64, encodeHashToBase64 } from '@holochain/client';
import { consume } from '@lit-labs/context';
import { localized, msg } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import SlSelect from '@shoelace-style/shoelace/dist/components/select/select.js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

import { weStoreContext } from '../context.js';
import { WeStore } from '../we-store.js';
import { weStyles } from '../shared-styles.js';

@localized()
@customElement('select-group-dialog')
export class SelectGroupDialog extends LitElement {
  @consume({ context: weStoreContext })
  _weStore!: WeStore;

  _groups = new StoreSubscriber(
    this,
    () => this._weStore.allGroupsProfiles,
    () => [this._weStore],
  );

  show() {
    this._selectedGroupDnaHash = undefined;
    this._groupSelector.value = '';
    this._dialog.show();
  }

  hide() {
    this._selectedGroupDnaHash = undefined;
    this._groupSelector.value = '';
    this._dialog.hide();
  }

  @state()
  _selectedGroupDnaHash: DnaHashB64 | undefined;

  @query('#group-selector')
  _groupSelector!: SlSelect;

  @query('#dialog')
  _dialog!: SlDialog;

  renderDialogContent() {
    switch (this._groups.value.status) {
      case 'pending':
        return html`<div class="row center-content" style="flex: 1">
          <sl-spinner style="font-size: 2rem"></sl-spinner>
        </div>`;
      case 'complete':
        const groups = Array.from(this._groups.value.value.entries());

        if (groups.length === 0) {
          return html`<span style="margin-bottom: 20px;"><b>You need to create or join a Group before you can install Applets.<b></span>`;
        }

        return html`
          <sl-select
            id="group-selector"
            .placeholder=${msg('Select Group')}
            name="groupDnaHash"
            style="margin-top: 16px; margin-bottom: 20px;"
            @sl-input=${() => {
              this._selectedGroupDnaHash = this._groupSelector.value as string | undefined;
            }}
            placement="bottom"
            hoist
            required
          >
            ${groups.map(
              ([groupDnaHash, groupProfile]) => html`
                <sl-option .value=${encodeHashToBase64(groupDnaHash)}>
                  <img
                    slot="prefix"
                    .src=${groupProfile?.logo_src}
                    alt="${groupProfile?.name}"
                    style="height: 16px; width: 16px"
                  />${groupProfile?.name}</sl-option
                >
              `,
            )}
          </sl-select>
        `;

      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching your groups')}
          .error=${this._groups.value.error}
        ></display-error>`;
    }
  }

  render() {
    return html`<sl-dialog id="dialog" .label=${msg('Select Group')}>
      <div class="column">Select in which Group you would like to install the Applet:</div>
      <div class="column" style="margin-top: 10px;">
        ${this.renderDialogContent()}
        <sl-button
          ?disabled=${!this._selectedGroupDnaHash}
          variant="primary"
          @click=${() => {
            this.dispatchEvent(
              new CustomEvent('installation-group-selected', {
                detail: this._selectedGroupDnaHash,
                bubbles: true,
                composed: true,
              }),
            );
          }}
          @keyup=${(e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.code === '32') {
              this.dispatchEvent(
                new CustomEvent('installation-group-selected', {
                  detail: this._selectedGroupDnaHash,
                  bubbles: true,
                  composed: true,
                }),
              );
            }
          }}
          >Next</sl-button
        >
      </div>
    </sl-dialog>`;
  }

  static styles = [weStyles, css``];
}

import { DnaHashB64, encodeHashToBase64 } from '@holochain/client';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { css, html, LitElement, PropertyValues } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import SlSelect from '@shoelace-style/shoelace/dist/components/select/select.js';

import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { mossStyles } from '../../shared-styles.js';

@localized()
@customElement('group-selector')
export class GroupSelector extends LitElement {
  @consume({ context: mossStoreContext })
  _mossStore!: MossStore;

  _groups = new StoreSubscriber(
    this,
    () => this._mossStore.allGroupsProfiles,
    () => [this._mossStore],
  );

  @property()
  groupDnaHashB64: DnaHashB64 | undefined; // optional property taht will define the initial state

  @state()
  _selectedGroupDnaHash: DnaHashB64 | undefined;

  @query('#group-selector')
  _groupSelector!: SlSelect;

  willUpdate(changedProperties: PropertyValues<this>) {
    if (changedProperties.has('groupDnaHashB64')) {
      this._selectedGroupDnaHash = this.groupDnaHashB64;
    }
  }

  firstUpdated() {
    this._selectedGroupDnaHash = this.groupDnaHashB64;
  }

  render() {
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

        let customGroupOrder = this._mossStore.persistedStore.groupOrder.value();

        const selectedGroup = groups.find(
          ([dnaHash, _]) =>
            this._selectedGroupDnaHash &&
            encodeHashToBase64(dnaHash) === this._selectedGroupDnaHash,
        );

        return html`
          <sl-select
            id="group-selector"
            .placeholder=${msg('Select Group')}
            .value=${this.groupDnaHashB64}
            style="margin-top: 16px; margin-bottom: 20px;"
            @sl-input=${() => {
              this._selectedGroupDnaHash = this._groupSelector.value as string | undefined;
              if (this._selectedGroupDnaHash) {
                this.dispatchEvent(
                  new CustomEvent('group-selected', {
                    detail: this._selectedGroupDnaHash,
                    bubbles: true,
                    composed: true,
                  }),
                );
              }
            }}
            placement="bottom"
            hoist
            required
          >
            ${selectedGroup && selectedGroup[1]
              ? html`<img
                  slot="prefix"
                  .src=${selectedGroup[1].icon_src}
                  alt="${selectedGroup[1].name}"
                  style="height: 18px; width: 18px; margin-right: 7px; margin-left: -5px;"
                />`
              : html`<div slot="prefix" style="width: 4px;"></div>`}
            ${groups
              .sort(
                ([a_hash, _a], [b_hash, _b]) =>
                  customGroupOrder!.indexOf(encodeHashToBase64(a_hash)) -
                  customGroupOrder!.indexOf(encodeHashToBase64(b_hash)),
              )
              .map(
                ([groupDnaHash, groupProfile]) => html`
                  <sl-option .value=${encodeHashToBase64(groupDnaHash)}>
                    <img
                      slot="prefix"
                      .src=${groupProfile?.icon_src}
                      alt="${groupProfile?.name}"
                      style="height: 16px; width: 16px"
                    />
                    <span>${groupProfile?.name}</span>
                  </sl-option>
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

  static styles = [mossStyles, css``];
}

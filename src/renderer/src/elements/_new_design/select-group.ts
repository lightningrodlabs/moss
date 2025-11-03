import { DnaHashB64, encodeHashToBase64 } from '@holochain/client';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/dropdown/dropdown.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import SlDropdown from '@shoelace-style/shoelace/dist/components/dropdown/dropdown.js';

import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { mossStyles } from '../../shared-styles.js';
import { installToolIcon } from './icons.js';

@localized()
@customElement('select-group')
export class SelectGroup extends LitElement {
  @consume({ context: mossStoreContext })
  _mossStore!: MossStore;

  _groups = new StoreSubscriber(
    this,
    () => this._mossStore.allGroupsProfiles,
    () => [this._mossStore],
  );

  show() {
    this._selectedGroupDnaHash = undefined;
    // if (this._groupSelector) {
    //   this._groupSelector.value = '';
    // }
    this._groupSelector.show();
  }

  hide() {
    this._selectedGroupDnaHash = undefined;
    // if (this._groupSelector) {
    //   this._groupSelector.value = '';
    // }
    this._groupSelector.hide();
  }

  @state()
  _selectedGroupDnaHash: DnaHashB64 | undefined;

  @query('#group-selector')
  _groupSelector!: SlDropdown;

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

        return html`
          <sl-dropdown
            id="group-selector"
            .placeholder=${msg('Select Group')}
            name="groupDnaHash"
            style="margin-top: 16px; margin-bottom: 20px;width:263px"
            @click=${(e) => e.stopPropagation()}
            @sl-select=${(e: CustomEvent) => {
              this._selectedGroupDnaHash = e.detail.item.value;
              this.dispatchEvent(
                new CustomEvent('group-selected', {
                  detail: this._selectedGroupDnaHash,
                  bubbles: true,
                  composed: true,
                }),
              );
            }}
            placement="bottom"
            hoist
            required
          >
            <button slot="trigger" class="install-button moss-button" style="width:100%">
              <div class="row center-content">
                ${installToolIcon(20)}
                <div style="margin-left: 10px;">${msg('Install to a group space')}</div>
              </div>
            </button>
            <sl-menu>
              ${groups
                .sort(
                  ([a_hash, _a], [b_hash, _b]) =>
                    customGroupOrder!.indexOf(encodeHashToBase64(a_hash)) -
                    customGroupOrder!.indexOf(encodeHashToBase64(b_hash)),
                )
                .map(
                  ([groupDnaHash, groupProfile]) => html`
                    <sl-menu-item value=${encodeHashToBase64(groupDnaHash)}>
                      <img
                        slot="prefix"
                        .src=${groupProfile?.icon_src}
                        alt="${groupProfile?.name}"
                        style="height: 28px; width: 28px"
                      />${groupProfile?.name}</sl-menu-item
                    >
                  `,
                )}
            </sl-menu>
          </sl-dropdown>
        `;

      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching your groups')}
          .error=${this._groups.value.error}
        ></display-error>`;
    }
  }

  static styles = [
    mossStyles,
    css`
      sl-menu {
        width: 286px;
        background: var(--moss-dark-button);
        border-radius: 8px;
        margin-top: -1px;
      }
      sl-menu-item::part(base) {
        border-radius: 8px;

        margin-left: 12px;
        margin-right: 12px;
        border: solid 2px;
        border-color: var(--moss-dark-button);
        background: var(--moss-dark-button);
        color: white;
      }
      sl-menu-item::part(base):hover {
        background-color: rgba(255, 255, 255, 0.1);
      }
      sl-menu-item::part(prefix) {
        margin: 0px;
        color: white;
      }
      sl-menu-item::part(prefix) img[slot='prefix'] {
        filter: invert(1) brightness(1.2);
      }
    `,
  ];
}

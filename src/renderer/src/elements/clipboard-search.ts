import { customElement, property, state, query } from 'lit/decorators.js';
import { css, html, LitElement } from 'lit';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import {
  FormField,
  FormFieldController,
  hashProperty,
  sharedStyles,
  wrapPathInSvg,
} from '@holochain-open-dev/elements';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/menu/menu.js';
import '@shoelace-style/shoelace/dist/components/menu-item/menu-item.js';
import '@shoelace-style/shoelace/dist/components/dropdown/dropdown.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import SlInput from '@shoelace-style/shoelace/dist/components/input/input.js';
import SlDropdown from '@shoelace-style/shoelace/dist/components/dropdown/dropdown.js';

import {
  AppletInfo,
  AttachableLocationAndInfo,
  GroupProfile,
  HrlWithContext,
  WeClient,
  WeServices,
} from '@lightningrodlabs/we-applet';
import { EntryHash } from '@holochain/client';
import { DnaHash } from '@holochain/client';
import { weClientContext } from '@lightningrodlabs/we-elements';
import { mdiMagnify } from '@mdi/js';
import { weStoreContext } from '../context';
import { WeStore } from '../we-store';
import './search-result-element';

export interface SearchResult {
  hrlsWithInfo: Array<[HrlWithContext, AttachableLocationAndInfo]>;
  groupsProfiles: ReadonlyMap<DnaHash, GroupProfile>;
  appletsInfos: ReadonlyMap<EntryHash, AppletInfo>;
}

/**
 * @element search-entry
 * @fires entry-selected - Fired when the user selects some entry. Detail will have this shape: { hrl, context }
 */
@localized()
@customElement('clipboard-search')
export class ClipboardSearch extends LitElement implements FormField {
  /** Form field properties */

  @consume({ context: weStoreContext })
  @state()
  _weStore!: WeStore;

  /**
   * The name of the field if this element is used inside a form
   * Required only if the element is used inside a form
   */
  @property()
  name!: string;

  /**
   * The default value of the field if this element is used inside a form
   */
  @property(hashProperty('default-value'))
  defaultValue: HrlWithContext | undefined;

  /**
   * Whether this field is required if this element is used inside a form
   */
  @property()
  required = false;

  /**
   * Whether this field is disabled if this element is used inside a form
   */
  @property()
  disabled = false;

  /** Public attributes */

  /**
   * Label for the entry searching field.
   * @attr field-label
   */
  @property({ type: String, attribute: 'field-label' })
  fieldLabel: string = '';

  /**
   * Label for the entry searching field.
   * @attr field-label
   */
  @property({ type: String, attribute: 'placeholder' })
  placeholder: string = msg('Search entry');

  @property({ type: Number, attribute: 'min-chars' })
  minChars: number = 2;

  @consume({ context: weClientContext, subscribe: true })
  @property()
  weClient!: WeClient | WeServices;

  /**
   * @internal
   */
  @state()
  value!: HrlWithContext | undefined;

  @state()
  filterLength: number = 0;

  @state()
  _searchResults = new StoreSubscriber(
    this,
    () => this._weStore.searchResults(),
    () => [this._weStore],
  );

  _controller = new FormFieldController(this);

  reportValidity() {
    const invalid = this.required !== false && this.value === undefined;

    if (invalid) {
      this._textField.setCustomValidity(`This field is required`);
      this._textField.reportValidity();
    }

    return !invalid;
  }

  reset() {
    setTimeout(() => {
      this._textField.value = '';
      this.value = this.defaultValue;
    });
  }

  @query('#textfield')
  private _textField!: SlInput;

  @query('#dropdown')
  private dropdown!: SlDropdown;

  focus() {
    this._textField.focus();
    this._textField.select();
  }

  firstUpdated() {
    this._textField.addEventListener('keydown', (event) => {
      if (event.key === ' ') {
        event.stopPropagation();
      }
    });
  }

  search(filter: string): void {
    setTimeout(async () => this.weClient.search(filter));
  }

  onFilterChange() {
    const filter = this._textField.value;
    this.filterLength = filter.length;
    this.dropdown.show();
    if (filter.length < this.minChars) {
      this._weStore.clearSearchResults();
      if (filter.length === 0) this.dropdown.hide();
      return;
    }
    this.search(filter);
  }

  onEntrySelected(hrlWithContext: HrlWithContext) {
    this.dispatchEvent(
      new CustomEvent('entry-selected', {
        detail: {
          hrlWithContext,
        },
      }),
    );
    this.value = hrlWithContext;

    this.dropdown.hide();
  }

  onCopyToClipboard(hrlWithContext: HrlWithContext, _info: AttachableLocationAndInfo) {
    this.dispatchEvent(
      new CustomEvent('hrl-to-clipboard', {
        detail: {
          hrlWithContext,
        },
      }),
    );
  }

  renderEntryList() {
    if (this._searchResults.value[0].length === 0) {
      if (this.filterLength < this.minChars) {
        return html`<span style="padding-left: 20px;"
          >${msg(`Enter at least ${this.minChars} characters to start searching.`)}</span
        >`;
      }
      if (this._searchResults.value[1] === 'complete') {
        return html`<span style="padding-left: 20px;">${msg('No results found.')}</span>`;
      } else {
        return html`<span style="padding-left: 20px;">${msg('Searching...')}</span>`;
      }
    }
    return html`
      ${this._searchResults.value[0].map(
        (hrlWithContext) => html`
          <search-result-element .hrlWithContext=${hrlWithContext}></search-result-element>
        `,
      )}
      ${this._searchResults.value[1] === 'loading'
        ? html`
            <sl-menu-item>
              <div class="row" style="align-items: center">
                <span>loading more...</span>
              </div>
            </sl-menu-item>
          `
        : html``}
    `;
  }

  /**
   * @internal
   */
  get _label() {
    let l = this.fieldLabel;

    if (this.required !== false) l = `${l} *`;

    return l;
  }

  render() {
    return html`
      <div style="flex: 1; display: flex; width: 600px;">
        <sl-dropdown style="display: flex; flex: 1; width: 600px;" id="dropdown" hoist>
          <sl-input
            id="textfield"
            slot="trigger"
            style="width: 600px;"
            .label=${this._label}
            .placeholder=${this.placeholder}
            @input=${() => this.onFilterChange()}
          >
            <sl-icon .src=${wrapPathInSvg(mdiMagnify)} slot="prefix"></sl-icon>
          </sl-input>
          <sl-menu
            id="search-results"
            style="min-width: 600px;"
            @sl-select=${(e: CustomEvent) => {
              this.onEntrySelected(e.detail.item.hrlWithContext);
            }}
          >
            ${this.renderEntryList()}
          </sl-menu>
        </sl-dropdown>
      </div>
    `;
  }

  static get styles() {
    return [
      sharedStyles,
      css`
        :host {
          display: flex;
        }

        .to-clipboard {
          background: #2eb2d7;
          border-radius: 5px;
          padding: 0 8px;
          box-shadow: 0 0 3px black;
        }

        .to-clipboard:hover {
          background: #7fd3eb;
        }
      `,
    ];
  }
}

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

import { AssetLocationAndInfo, WAL } from '@lightningrodlabs/we-applet';
import { mdiArrowRight, mdiMagnify } from '@mdi/js';
import { mossStoreContext } from '../../context';
import { MossStore } from '../../moss-store';
import './search-result-element';

/**
 * @element search-entry
 * @fires entry-selected - Fired when the user selects some entry. Detail will have this shape: { hrl, context }
 */
@localized()
@customElement('pocket-search')
export class PocketSearch extends LitElement implements FormField {
  /** Form field properties */

  @consume({ context: mossStoreContext })
  @state()
  _mossStore!: MossStore;

  /**
   * The name of the field if this element is used inside a form
   * Required only if the element is used inside a form
   */
  @property()
  name!: string;

  @property()
  mode: 'open' | 'select' = 'open';

  /**
   * The default value of the field if this element is used inside a form
   */
  @property(hashProperty('default-value'))
  defaultValue: WAL | undefined;

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
  placeholder: string = msg('Search or enter weave-0.13:// URL');

  @property({ type: Number, attribute: 'min-chars' })
  minChars: number = 2;

  /**
   * @internal
   */
  @state()
  value!: WAL | undefined;

  @state()
  filterLength: number = 0;

  @state()
  wurl: string | undefined;

  @state()
  _searchResults = new StoreSubscriber(
    this,
    () => this._mossStore.searchResults(),
    () => [this._mossStore],
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
      if (event.key === 'Enter' && this.wurl) {
        this.openWurl();
      }
    });
  }

  search(filter: string): void {
    setTimeout(async () => this._mossStore.search(filter));
  }

  onFilterChange() {
    const filter = this._textField.value;
    if (this.mode === 'open') {
      if (filter.startsWith('weave-0.13://')) {
        // No dropdown but enable opening of WAL
        this.wurl = filter;
        this.dropdown.hide();
        return;
      } else {
        this.wurl = undefined;
      }
    }
    this.filterLength = filter.length;
    this.dropdown.show();
    if (filter.length < this.minChars) {
      this._mossStore.clearSearchResults();
      if (filter.length === 0) this.dropdown.hide();
      return;
    }
    this.search(filter);
  }

  onEntrySelected(wal: WAL) {
    this.dispatchEvent(
      new CustomEvent('entry-selected', {
        detail: {
          wal,
        },
      }),
    );
    this.value = wal;

    this.dropdown.hide();
  }

  onCopyToClipboard(wal: WAL, _info: AssetLocationAndInfo) {
    this.dispatchEvent(
      new CustomEvent('wal-to-pocket', {
        detail: {
          wal,
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
        (wal) => html` <search-result-element .wal=${wal}></search-result-element> `,
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

  openWurl() {
    if (this.wurl) {
      this.dispatchEvent(
        new CustomEvent('open-wurl', {
          detail: {
            wurl: this.wurl,
          },
        }),
      );
    }
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
        <div class="row" style="align-items: center;">
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
                this.onEntrySelected(e.detail.item.wal);
              }}
            >
              ${this.renderEntryList()}
            </sl-menu>
          </sl-dropdown>
          ${this.mode === 'open'
            ? html`
                <button
                  style="margin-left: 5px; padding: 3px; height: 32px; width: 32px;"
                  title=${msg('Open URL')}
                  ?disabled=${!this.wurl}
                  @click=${() => this.openWurl()}
                >
                  <sl-icon
                    style="font-size: 26px; color: white;"
                    .src=${wrapPathInSvg(mdiArrowRight)}
                  ></sl-icon>
                </button>
              `
            : html``}
        </div>
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

        button {
          all: unset;
          background: var(--sl-color-primary-300);
          box-shadow: 1px 1px 1px 1px var(--sl-color-primary-600);
          border-radius: 3px;
          margin: 0;
          padding: 0;
          cursor: pointer;
          display: flex;
          justify-content: center;
          align-items: center;
          margin-top: -2px;
        }

        button:hover:not(:disabled) {
          background: var(--sl-color-primary-100);
        }

        button:disabled {
          opacity: 0.6;
          cursor: auto;
          box-shadow: none;
        }
      `,
    ];
  }
}

import { customElement, state, query, property } from 'lit/decorators.js';
import { css, html, LitElement } from 'lit';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { sharedStyles, wrapPathInSvg } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@theweave/elements/dist/elements/weave-client-context.js';

import { DnaHashB64, encodeHashToBase64, EntryHash } from '@holochain/client';
import { DnaHash } from '@holochain/client';
import { AppletInfo, AssetLocationAndInfo, GroupProfile, WAL } from '@theweave/api';
import { SlDialog, SlInput } from '@shoelace-style/shoelace';
import { mossStoreContext } from '../../context.js';
import { MossStore, WalInPocket } from '../../moss-store.js';
import { pipe, StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { dedupStringArray } from '../../utils.js';
import { mdiArrowRight } from '@mdi/js';
import { mossStyles } from '../../shared-styles.js';

export interface SearchResult {
  hrlsWithInfo: Array<[WAL, AssetLocationAndInfo]>;
  groupsProfiles: ReadonlyMap<DnaHash, GroupProfile>;
  appletsInfos: ReadonlyMap<EntryHash, AppletInfo>;
}

/**
 * @element search-entry
 * @fires entry-selected - Fired when the user selects some entry. Detail will have this shape: { hrl, context }
 */
@localized()
@customElement('tag-selection-dialog')
export class TagSelectionDialog extends LitElement {
  @consume({ context: mossStoreContext })
  @state()
  _mossStore!: MossStore;

  /**
   * The tag selection dialog highlights tags of a specific group
   */
  @property()
  groupDnaHash: DnaHash | undefined;

  @query('#tag-selection-dialog')
  _dialog!: SlDialog;

  @query('#new-tag-input')
  _newTagInput!: SlInput;

  @state()
  pocketContent: Array<WalInPocket> = [];

  @state()
  filter: string = '';

  existingAssetTags = new StoreSubscriber(
    this,
    () =>
      pipe(this._mossStore.groupStores, async (groupStores) => {
        const allTags: Record<DnaHashB64, string[]> = {};
        await Promise.all(
          Array.from(groupStores.entries()).map(async ([groupDnaHash, groupStore]) => {
            const assetTags = await toPromise(groupStore.allAssetRelationTags);
            allTags[encodeHashToBase64(groupDnaHash)] = assetTags;
          }),
        );
        return allTags;
      }),
    () => [this._mossStore],
  );

  show() {
    this._dialog.show();
    console.log('this._newTagInput', this._newTagInput);
    setTimeout(() => this._newTagInput.focus());
  }

  hide() {
    this._dialog.hide();
  }

  async returnInputTag() {
    this.dispatchEvent(
      new CustomEvent('asset-relation-tag-selected', {
        detail: this._newTagInput.value,
        bubbles: true,
        composed: true,
      }),
    );
    this._newTagInput.value = '';
    this.filter = '';
    this.hide();
  }

  async returnTag(tag: string) {
    this.dispatchEvent(
      new CustomEvent('asset-relation-tag-selected', {
        detail: tag,
        bubbles: true,
        composed: true,
      }),
    );
    this._newTagInput.value = '';
    this.filter = '';
    this.hide();
  }

  renderTags() {
    switch (this.existingAssetTags.value.status) {
      case 'pending':
        return html`loading...`;
      case 'error':
        console.error('Failed to get existing tags: ', this.existingAssetTags.value.error);
        return html`Error (see console for details)`;
      case 'complete':
        // For now we just show all tags of all groups equally. At some point we may want to
        // present tags of the group that the asset which asked for the tag-selection-dialog
        // belongs to in a highlighted manner
        const tagsFlattened = dedupStringArray(
          Object.values(this.existingAssetTags.value.value).flat(),
        ).filter((tag) => tag.toLowerCase().startsWith(this.filter));
        return html`
          <div class="column flex-1 center-content" style="min-width: 500px;">
            ${tagsFlattened.length === 0
              ? html`<div style="margin-top: 5px;">
                  ${this.filter === ''
                    ? msg('No existing asset relation tags yet...')
                    : msg('No tags with this search filter')}
                </div>`
              : html`
                  <div class="column center-content">
                    <div style="font-weight: bold; margin-bottom: 10px;">
                      ${msg('Select existing tag:')}
                    </div>
                    <div class="row" style="flex-wrap: wrap;">
                      ${tagsFlattened.map(
                        (tag) =>
                          html`<button
                            @click=${() => this.returnTag(tag)}
                            class="btn tag-btn"
                            style="margin: 2px;"
                          >
                            ${tag}
                          </button>`,
                      )}
                    </div>
                  </div>
                `}
          </div>
        `;
    }
  }

  render() {
    return html`
      <sl-dialog id="tag-selection-dialog" class="moss-dialog" style="--width: 800px;" no-header>
        <div class="column center-content">
          <h2>${msg('Choose Asset Relation Tag:')}</h2>
          <div class="row center-content" style="margin-bottom: 20px;">
            <sl-input
              id="new-tag-input"
              class="moss-input-no-label"
              slot="trigger"
              style="width: 600px;"
              .placeholder=${msg('Enter new tag')}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  this.returnInputTag();
                }
              }}
              @input=${() => {
                this.filter = this._newTagInput.value;
              }}
            >
            </sl-input>
            <button
              class="moss-button"
              style="margin-left: 5px; padding: 12px; border-radius: 10px;"
              style="margin-left: 5px; padding: 3px; height: 32px; width: 32px;"
              title=${msg('Enter')}
              ?disabled=${this._newTagInput && this._newTagInput.value === ''}
              @click=${() => this.returnInputTag()}
            >
              <div class="column center-content">
                <sl-icon
                  style="font-size: 26px; color: white;"
                  .src=${wrapPathInSvg(mdiArrowRight)}
                ></sl-icon>
              </div>
            </button>
          </div>
          ${this.renderTags()}
        </div>
      </sl-dialog>
    `;
  }

  static get styles() {
    return [
      mossStyles,
      sharedStyles,
      css`
        :host {
          display: flex;
        }

        sl-button.clear-pocket::part(base) {
          color: var(--sl-color-primary-600);
        }

        sl-button.clear-pocket::part(base):hover {
          color: var(--sl-color-primary-900);
        }

        #new-tag-input {
          font-size: 18px;
          margin-right: 5px;
        }

        .enter-btn:disabled {
          opacity: 0.6;
          cursor: auto;
          box-shadow: none;
        }

        .btn:focus-visible {
          background: #4b97ee;
        }

        .btn {
          all: unset;
          cursor: pointer;
          border-radius: 10px;
          border: 2px solid transparent;
          background: #00346e;
        }

        .tag-btn {
          border-radius: 3px;
          background: #145cae;
          padding: 2px;
          color: white;
        }

        .tag-btn:hover {
          background: #4b97ee;
        }
      `,
    ];
  }
}

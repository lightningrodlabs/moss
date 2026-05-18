import { customElement, state } from 'lit/decorators.js';
import { css, html, LitElement } from 'lit';
import { consume } from '@lit/context';
import { localized } from '@lit/localize';
import { wrapPathInSvg } from '@holochain-open-dev/elements';

import { EntryHash } from '@holochain/client';
import { DnaHash } from '@holochain/client';
import { AppletInfo, AssetLocationAndInfo, GroupProfile, WAL } from '@theweave/api';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import './wal-element.js';
import './wal-created-element.js';
import './pocket-search.js';
import { mdiArrowDownBoldBoxOutline } from '@mdi/js';
import { mossStyles } from '../../shared-styles.js';
import { get } from '@holochain-open-dev/stores';

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
@customElement('pocket-drop')
export class PocketDrop extends LitElement {
  @consume({ context: mossStoreContext })
  @state()
  _mossStore!: MossStore;

  @state()
  hovering = false;

  // https://stackoverflow.com/questions/7110353/html5-dragleave-fired-when-hovering-a-child-element
  @state()
  dragCounter = 0;

  firstUpdated() {
    // Clear if not dropped after 3 seconds
    setTimeout(() => this.handleDropCancel(), 3000);
  }

  requestCreate() {
    this.dispatchEvent(
      new CustomEvent('open-creatable-palette', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  walToPocket(wal: WAL) {
    console.log('Adding hrl to pocket: ', wal);
    this._mossStore.walToPocket(wal);
  }

  handleDrop = () => {
    const wal = get(this._mossStore.draggedWal());
    if (wal) {
      this._mossStore.clearDraggedWal();
      this.dispatchEvent(
        new CustomEvent('wal-dropped', {
          composed: true,
        }),
      );
      setTimeout(() => {
        this.walToPocket(wal);
      }, 200);
    }
  };

  handleDropCancel = () => {
    this._mossStore.clearDraggedWal();
    this.dispatchEvent(
      new CustomEvent('wal-dropped', {
        composed: true,
      }),
    );
  };

  render() {
    return html`
      <div
        class="column flex-1"
        style="align-items: center; position: relative; color: white; background: transparent;"
        @dragover=${(e: DragEvent) => {
          e.preventDefault();
        }}
        @drop=${this.handleDropCancel}
      >
        <div
          class="column flex-1 justify-center hover-area ${this.hovering ? 'hovering' : ''}"
          style="position: fixed; bottom: 0; right: 0; height: 30vh; width: calc(100vw - 74px); margin-left: 74px;"
          @dragover=${(e: DragEvent) => {
            e.preventDefault();
          }}
          @drop=${this.handleDrop}
          @dragenter=${() => {
            this.dragCounter++;
            this.hovering = true;
          }}
          @dragleave=${() => {
            this.dragCounter--;
            if (this.dragCounter === 0) {
              this.hovering = false;
            }
          }}
        >
          <div
            class="column center-content flex-1"
            style="opacity: 0.4; margin: 35px; border-radius: 50px; border: 3px dashed white;"
          >
            <div class="row items-center">
              <sl-icon
                style="font-size: 125px;"
                src=${wrapPathInSvg(mdiArrowDownBoldBoxOutline)}
              ></sl-icon>
              <span style="margin-left: 20px; font-size: 60px;">drop to add to pocket</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  static get styles() {
    return [
      mossStyles,
      css`
        :host {
          display: flex;
        }

        .hover-area {
          /* background: #87d11a4f; */
          /* background: #1e3300; */
          background: #000723;
        }

        .hovering {
          background: #232d53;
        }
      `,
    ];
  }
}

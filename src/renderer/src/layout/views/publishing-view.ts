import { html, LitElement, css } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';

import { weStyles } from '../../shared-styles.js';
import '../../elements/select-group-dialog.js';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { consume } from '@lit/context';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import './create-developer-collective.js';
import './developer-collective-view.js';
import '../../tools-library/developer-collective-context.js';
import { EntryRecord } from '@holochain-open-dev/utils';
import { DeveloperCollective } from '../../tools-library/types.js';
import { ActionHash, encodeHashToBase64 } from '@holochain/client';

enum PageView {
  DeveloperCollective,
  CreateDeveloperCollective,
}
@localized()
@customElement('publishing-view')
export class PublishingView extends LitElement {
  @consume({ context: mossStoreContext })
  mossStore!: MossStore;

  @state()
  view: PageView = PageView.CreateDeveloperCollective;

  _myDeveloperColletives = new StoreSubscriber(
    this,
    () => this.mossStore.toolsLibraryStore.myDeveloperCollectives,
    () => [],
  );

  @state()
  _selectedDeveloperCollective: ActionHash | undefined;

  async firstUpdated() {}

  renderDeveloperCollective() {
    console.log('RENDERING DEV COLLECTIVE FOR HASH: ', this._selectedDeveloperCollective);
    console.log(
      'RENDERING DEV COLLECTIVE FOR B64 HASH: ',
      encodeHashToBase64(this._selectedDeveloperCollective!),
    );
    return html`<developer-collective-view
      class="flex-scrollable-container"
      .developerCollectiveHash=${this._selectedDeveloperCollective}
    ></developer-collective-view>`;
  }

  renderCreateDeveloperCollective() {
    return html` <create-developer-collective></create-developer-collective> `;
  }

  renderContent() {
    switch (this.view) {
      case PageView.CreateDeveloperCollective:
        console.log('Rendering create publisher view');
        return this.renderCreateDeveloperCollective();
      case PageView.DeveloperCollective:
        return this.renderDeveloperCollective();
      default:
        return html`<div class="column center-content" style="flex: 1;">Error</div>`;
    }
  }

  renderSidebar(myDeveloperCollectives: [ActionHash, EntryRecord<DeveloperCollective>][]) {
    console.log('MY DEVELOPER COLLECTIVES: ', myDeveloperCollectives);
    return html` <div class="column" style="color: black; left: 260px;">
      ${myDeveloperCollectives.map(
        ([originalHash, collectiveRecord]) =>
          html`<div
            class="sidebar-btn"
            @click=${() => {
              this._selectedDeveloperCollective = originalHash;
              this.view = PageView.DeveloperCollective;
            }}
          >
            ${collectiveRecord.entry.name}
          </div>`,
      )}
    </div>`;
  }

  render() {
    switch (this._myDeveloperColletives.value.status) {
      case 'pending':
        return html`<div class="column center-content" style="flex: 1;">Loading...</div>`;
      case 'error':
        console.error(
          'Failed to fetch my developer collectives: ',
          this._myDeveloperColletives.value.error,
        );
        return html`<div class="column center-content" style="flex: 1;">
          Error: Failed to fetch my developer collectives. See console for details.
        </div>`;
      case 'complete':
        return html`
          <div class="row" style="display: flex; flex: 1;">
            <div class="sidebar">
              ${this.renderSidebar(this._myDeveloperColletives.value.value)}
            </div>
            <div class="column" style="flex: 1; position: relative; margin: 0;">
              ${this.renderContent()}
            </div>
          </div>
        `;
    }
  }

  static styles = [
    weStyles,
    css`
      :host {
        display: flex;
        flex: 1;
      }

      .sidebar {
        width: 250px;
        background: green;
        padding: 5px;
        padding-top: 20px;
      }

      .sidebar-btn {
        background: yellow;
        border-radius: 8px;
        padding: 5px;
        cursor: pointer;
      }

      .sidebar-btn:hover {
        background: #96ed64;
      }

      .title {
        font-size: 30px;
      }

      .btn {
        all: unset;
        margin: 12px;
        font-size: 25px;
        height: 100px;
        min-width: 300px;
        background: var(--sl-color-primary-800);
        color: white;
        border-radius: 10px;
        cursor: pointer;
        box-shadow: 0 2px 5px var(--sl-color-primary-900);
      }

      .btn:hover {
        background: var(--sl-color-primary-700);
      }

      .btn:active {
        background: var(--sl-color-primary-600);
      }

      .icon-picker {
        height: 200px;
        width: 200px;
        border-radius: 40px;
        cursor: pointer;
        margin-bottom: 20px;
      }

      .icon-picker:hover {
        opacity: 0.7;
      }

      .picker-btn {
        border: 2px solid #7e7e7e;
        color: #7e7e7e;
        background: #f9f9f9;
      }
      .picker-btn:hover {
        color: black;
        border: 2px solid black;
      }
    `,
  ];
}

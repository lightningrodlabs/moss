import { html, LitElement, css } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { localized } from '@lit/localize';
import { hashProperty, notifyError } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';

import { weStyles } from '../../shared-styles.js';
import '../../elements/select-group-dialog.js';
import './publish-tool.js';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { consume } from '@lit/context';
import { ActionHash } from '@holochain/client';
import { resizeAndExport } from '../../utils.js';
import { DeveloperCollective, Tool } from '../../tools-library/types.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { EntryRecord } from '@holochain-open-dev/utils';

enum PageView {
  Loading,
  Main,
  UpdatePublisher,
  PublishTool,
  UpdateTool,
}
@localized()
@customElement('developer-collective-view')
export class DeveloperCollectiveView extends LitElement {
  @consume({ context: mossStoreContext })
  mossStore!: MossStore;

  @property(hashProperty('developer-collective-hash'))
  developerCollectiveHash!: ActionHash;

  async firstUpdated() {
    console.log('hash: ', this.developerCollectiveHash);
    this.allTools =
      await this.mossStore.toolsLibraryStore.toolsLibraryClient.getToolsForDeveloperCollective(
        this.developerCollectiveHash,
      );
    this.loadingTools = false;
  }

  @state()
  loadingTools = true;

  allTools: [ActionHash, EntryRecord<Tool>][] = [];

  @state()
  view: PageView = PageView.Main;

  @state()
  _iconSrc: string | undefined;

  @state()
  _creatingCollective = false;

  @state()
  _updatingPublisher = false;

  @state()
  _publishing: string | undefined = undefined;

  @state()
  _updating: string | undefined = undefined;

  @query('#publisher-icon-file-picker')
  private _iconFilePicker!: HTMLInputElement;

  _developerCollective = new StoreSubscriber(
    this,
    () =>
      this.mossStore.toolsLibraryStore.allDeveloperCollectives.get(this.developerCollectiveHash),
    () => [this.developerCollectiveHash],
  );

  onPublisherIconUploaded() {
    if (this._iconFilePicker.files && this._iconFilePicker.files[0]) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          this._iconSrc = resizeAndExport(img);
          this._iconFilePicker.value = '';
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(this._iconFilePicker.files[0]);
    }
  }

  async createDeveloperCollective(fields: { collective_name: string; collective_website: string }) {
    if (!this._iconSrc) {
      notifyError('No Icon provided.');
      throw new Error('Icon is required.');
    }
    this._creatingCollective = true;
    const payload: DeveloperCollective = {
      name: fields.collective_name,
      description: 'unknown',
      website: fields.collective_website,
      contact: 'unknown',
      icon: this._iconSrc,
      meta_data: undefined,
    };
    const developerCollectiveRecord =
      await this.mossStore.toolsLibraryStore.toolsLibraryClient.createDeveloperCollective(payload);
    this._creatingCollective = false;
    this._iconSrc = undefined;
    this.dispatchEvent(
      new CustomEvent('developer-collective-created', {
        detail: developerCollectiveRecord,
        bubbles: true,
        composed: true,
      }),
    );
  }

  renderTools() {
    if (this.loadingTools) return html`Loading Tools...`;
    if (this.allTools && this.allTools.length === 0) return html`No Tools published yet.`;
    return html`
      ${this.allTools.map(
        ([_originalHash, toolRecord]) => html` <div>${toolRecord.entry.title}</div> `,
      )}
    `;
  }

  renderContent(developerCollective: [ActionHash, EntryRecord<DeveloperCollective>] | undefined) {
    if (!developerCollective) return html`Developer Collective not found.`;
    return html`
      <div class="column" style="align-items: center;">
        <div>
          <img
            style="border-radius: 50%; height: 200px; width: 200px;"
            src=${developerCollective[1].entry.icon}
          />
        </div>
        <h1>${developerCollective[1].entry.name}</h1>
        ${this.renderTools()}
        <button
          @click=${() => {
            this.view = PageView.PublishTool;
          }}
        >
          Publish Tool
        </button>
      </div>
    `;
  }

  render() {
    switch (this.view) {
      case PageView.Main:
        switch (this._developerCollective.value.status) {
          case 'pending':
            return html`loading...`;
          case 'error':
            console.error(
              'Failed to get developer collective: ',
              this._developerCollective.value.error,
            );
            return html`Failed to get developer collective: ${this._developerCollective.value.error}`;
          case 'complete':
            return html`
              <div class="column flex-scrollable-y" style="padding: 16px; flex: 1">
                ${this.renderContent(this._developerCollective.value.value)}
              </div>
            `;
        }
      case PageView.PublishTool:
        return html`<publish-tool
          @cancel=${() => {
            this.view = PageView.Main;
          }}
          @tool-published=${async () => {
            this.allTools =
              await this.mossStore.toolsLibraryStore.toolsLibraryClient.getToolsForDeveloperCollective(
                this.developerCollectiveHash,
              );
            this.view = PageView.Main;
          }}
          .developerCollectiveHash=${this.developerCollectiveHash}
        ></publish-tool>`;
    }
  }

  static styles = [
    weStyles,
    css`
      :host {
        display: flex;
        flex: 1;
      }
      .applet-card {
        border-radius: 20px;
        border: 1px solid black;
        min-height: 90px;
        width: 600px;
        margin: 0;
        padding: 10px;
        --border-radius: 15px;
        cursor: pointer;
        border: none;
        --border-color: transparent;
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

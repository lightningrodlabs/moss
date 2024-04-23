import { html, LitElement, css, PropertyValueMap } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { hashProperty, notifyError } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';

import { weStyles } from '../../shared-styles.js';
import '../../elements/select-group-dialog.js';
import './publish-tool.js';
import './update-tool.js';

import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { consume } from '@lit/context';
import { ActionHash, decodeHashFromBase64, encodeHashToBase64 } from '@holochain/client';
import { resizeAndExport } from '../../utils.js';
import {
  ContributorPermission,
  DeveloperCollective,
  Tool,
  UpdateableEntity,
} from '../../tools-library/types.js';
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

  async willUpdate(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>) {
    if (changedProperties.has('developerCollectiveHash')) {
      this.loadingStuff = true;
      await this.fetchStuff();
    }
  }

  async fetchStuff() {
    this.allTools =
      await this.mossStore.toolsLibraryStore.toolsLibraryClient.getToolsForDeveloperCollective(
        this.developerCollectiveHash,
      );

    this.allContributorPermissions =
      await this.mossStore.toolsLibraryStore.toolsLibraryClient.getAllContributorPermissions(
        this.developerCollectiveHash,
      );

    this.loadingStuff = false;
  }

  @state()
  loadingStuff = true;

  @state()
  _selectedTab: 'contributors' | 'tools' = 'tools';

  allTools: UpdateableEntity<Tool>[] = [];

  allContributorPermissions: EntryRecord<ContributorPermission>[] = [];

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

  @state()
  _selectedTool: UpdateableEntity<Tool> | undefined;

  @state()
  _expirySelected: boolean = false;

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

  async deprecateTool(entity: UpdateableEntity<Tool>): Promise<void> {
    // TODO
  }

  updateExpirySelectState() {
    const expiryInput = this.shadowRoot?.getElementById('expiry-checkbox') as HTMLInputElement;
    if (expiryInput && expiryInput.checked) {
      this._expirySelected = true;
    } else {
      this._expirySelected = false;
    }
  }

  async createPermission() {
    console.log('Creating permission...');
    let usTimestamp;
    if (this._expirySelected) {
      const expiryInput = this.shadowRoot?.getElementById('permission-expiry') as HTMLInputElement;
      const msTimestamp = new Date(expiryInput.value).getTime();
      if (msTimestamp < Date.now()) {
        notifyError('Expiry must be in the future');
        throw new Error('Expiry must be in the future.');
      }
      usTimestamp = msTimestamp * 1000;
    }
    const pubkeyInput = this.shadowRoot?.getElementById(
      'add-contributor-pubkey',
    ) as HTMLInputElement;
    let forAgent;
    try {
      forAgent = decodeHashFromBase64(pubkeyInput.value);
      if (forAgent.length !== 39 || !pubkeyInput.value.startsWith('uhCAk')) {
        throw new Error('Invalid public key.');
      }
    } catch (e) {
      console.error(e);
      notifyError('Invalid public key.');
    }
    await this.mossStore.toolsLibraryStore.toolsLibraryClient.createContributorPermission({
      for_agent: forAgent,
      for_collective: this.developerCollectiveHash,
      expiry: usTimestamp ? usTimestamp : undefined,
    });
    await this.fetchStuff();
    this.requestUpdate();
  }

  renderTools() {
    if (this.loadingStuff) return html`Loading Tools...`;
    if (this.allTools && this.allTools.length === 0) return html`No Tools published yet.`;
    return html`
      ${this.allTools.map(
        (entity) =>
          html`<sl-card class="applet-card">
            <div class="row" style="align-items: center; flex: 1;">
              <span>${entity.record.entry.title}</span>
              <span style="display: flex; flex: 1;"></span>
              <sl-button
                variant="danger"
                style="margin-right: 10px;"
                @click=${() => {
                  this.deprecateTool(entity);
                }}
                @keypress=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    this.deprecateTool(entity);
                  }
                }}
                >Deprecate</sl-button
              >
              <sl-button
                @click=${() => {
                  console.log('toolEntity.content.source: ', entity.record.entry.source);
                  this._selectedTool = entity;
                  this.view = PageView.UpdateTool;
                }}
                @keypress=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter') {
                    this._selectedTool = entity;
                    this.view = PageView.UpdateTool;
                  }
                }}
                variant="primary"
                >Update
              </sl-button>
            </div>
          </sl-card>`,
      )}
    `;
  }

  renderContributors(developerCollective: UpdateableEntity<DeveloperCollective>) {
    const myPubKey = this.mossStore.toolsLibraryStore.toolsLibraryClient.client.myPubKey;
    const amIOwner = myPubKey.toString() === developerCollective.record.action.author.toString();
    return html` <div class="column" style="align-items: center;">
      <div class="row" style="align-items: center; margin-bottom: 10px;">
        <pre style="font-size: 16px; margin: 0;">
${encodeHashToBase64(developerCollective.record.action.author)}</pre
        >
        <span style="margin-left: 10px; font-weight: bold;">(Owner)</span>
        ${amIOwner
          ? html` <span style="margin-left: 5px; font-weight: bold;">(You)</span> `
          : html``}
      </div>
      ${this.allContributorPermissions.map(
        (permission) => html`
          <div class="row" style="align-items: center; margin-bottom: 10px;">
            <pre style="font-size: 16px; margin: 0;">
${encodeHashToBase64(permission.entry.for_agent)}</pre
            >
            <span style="margin-left: 10px; font-weight: bold;"
              >Expires:
              ${permission.entry.expiry
                ? new Date(permission.entry.expiry / 1000).toISOString()
                : 'Never'}</span
            >
            ${myPubKey.toString() === permission.entry.for_agent.toString()
              ? html` <span style="margin-left: 5px; font-weight: bold;">(You)</span> `
              : html``}
          </div>
        `,
      )}
      ${amIOwner
        ? html`
            <div style="font-weight: bold; margin-top: 50px; margin-bottom: 20px;">
              ${msg('Add Contributor:')}
            </div>
            <div>Public key:</div>
            <input
              id="add-contributor-pubkey"
              placeholder="public key"
              style="width: 600px; height: 20px;"
            />
            <div class="row" style="align-items: center; margin: 5px 0;">
              <input
                type="checkbox"
                id="expiry-checkbox"
                @input=${() => this.updateExpirySelectState()}
              />
              <span>expiry</span>
              <input
                ?disabled=${!this._expirySelected}
                type="date"
                id="permission-expiry"
                placeholder="expiry"
              />
            </div>
            <button
              @click=${async () => await this.createPermission()}
              style="margin-bottom: 50px;"
            >
              Add Contributor
            </button>
          `
        : html``}
    </div>`;
  }

  renderContent(developerCollective: UpdateableEntity<DeveloperCollective> | undefined) {
    if (!developerCollective) return html`Developer Collective not found.`;
    return html`
      <div class="column" style="align-items: center; flex: 1;">
        <div>
          <img
            style="border-radius: 50%; height: 200px; width: 200px;"
            src=${developerCollective.record.entry.icon}
          />
        </div>
        <h1>${developerCollective.record.entry.name}</h1>
        <div class="row tab-bar" style="align-items: center;">
          <div
            tabindex="0"
            class="tab-btn ${this._selectedTab === 'tools' ? 'selected' : ''}"
            style="border-radius: 30px 0 0 0;"
            @click=${() => {
              this._selectedTab = 'tools';
            }}
            @keypress=${(e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                this._selectedTab = 'tools';
              }
            }}
          >
            Tools
          </div>
          <div
            tabindex="0"
            class="tab-btn ${this._selectedTab === 'contributors' ? 'selected' : ''}"
            style=" border-radius: 0 30px 0 0;"
            @click=${() => {
              this._selectedTab = 'contributors';
            }}
            @keypress=${(e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                this._selectedTab = 'contributors';
              }
            }}
          >
            Contributors
          </div>
        </div>
        <div class="tab-section column" style="flex: 1; width: 100%; align-items: center;">
          ${this._selectedTab === 'tools'
            ? html` ${this.renderTools()}
                <button
                  @click=${() => {
                    this.view = PageView.PublishTool;
                  }}
                >
                  Publish Tool
                </button>`
            : this.renderContributors(developerCollective)}
        </div>
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
              <div class="column flex-scrollable-y" style="flex: 1; padding-top: 50px;">
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
      case PageView.UpdateTool:
        return html`<update-tool
          @cancel=${() => {
            this.view = PageView.Main;
          }}
          @tool-updated=${async () => {
            this.allTools =
              await this.mossStore.toolsLibraryStore.toolsLibraryClient.getToolsForDeveloperCollective(
                this.developerCollectiveHash,
              );
            this.view = PageView.Main;
          }}
          .developerCollectiveHash=${this.developerCollectiveHash}
          .toolEntity=${this._selectedTool}
        ></update-tool>`;
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

      .tab-btn {
        align-items: center;
        justify-content: center;
        text-align: center;
        font-size: 22px;
        font-weight: 600;
        width: 150px;
        padding: 16px;
        background: var(--sl-color-tertiary-100);
        cursor: pointer;
      }

      .tab-btn:hover {
        background: var(--sl-color-tertiary-200);
      }

      .selected {
        background: var(--sl-color-tertiary-200);
      }

      .tab-bar {
      }

      .tab-section {
        background: var(--sl-color-tertiary-200);
        padding-top: 30px;
        display: flex;
        flex: 1;
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

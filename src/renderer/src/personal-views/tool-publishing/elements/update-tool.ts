import { html, LitElement, css } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { hashProperty, notify, notifyError, onSubmit } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';

import { weStyles } from '../../../shared-styles.js';
import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';
import { consume } from '@lit/context';
import { ActionHash } from '@holochain/client';
import { notifyAndThrow, resizeAndExport } from '../../../utils.js';
import { AppHashes, WebHappSource } from '@theweave/moss-types';
import { validateHappOrWebhapp } from '../../../electron-api.js';
import { Tool, UpdateToolInput, UpdateableEntity, UpdatedTool } from '../../tool-library/types.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';

@localized()
@customElement('update-tool')
export class UpdateTool extends LitElement {
  @consume({ context: mossStoreContext })
  mossStore!: MossStore;

  @property(hashProperty('developer-collective-hash'))
  developerCollectiveHash!: ActionHash;

  @property()
  toolEntity!: UpdateableEntity<Tool>;

  @state()
  _toolIconSrc: string | undefined;

  @state()
  _updatedFields: {
    icon: string | undefined;
    title: string | undefined;
    subtitle: string | undefined;
    version: string | undefined;
    changelog: string | undefined;
    description: string | undefined;
    webhapp_url: string | undefined;
  } = {
    icon: undefined,
    title: undefined,
    subtitle: undefined,
    version: undefined,
    changelog: undefined,
    description: undefined,
    webhapp_url: undefined,
  };

  @state()
  _publishing: string | undefined = undefined;

  @state()
  _updating: string | undefined = undefined;

  @query('#update-tool-icon-file-picker')
  private _udpateToolIconFilePicker!: HTMLInputElement;

  _myDeveloperColletives = new StoreSubscriber(
    this,
    () => this.mossStore.toolsLibraryStore.myDeveloperCollectives,
    () => [],
  );

  onUpdateToolIconUploaded() {
    if (this._udpateToolIconFilePicker.files && this._udpateToolIconFilePicker.files[0]) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          this._toolIconSrc = resizeAndExport(img);
          this._udpateToolIconFilePicker.value = '';
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(this._udpateToolIconFilePicker.files[0]);
    }
  }

  async updateTool(fields: {
    title: string;
    subtitle: string;
    version: string;
    description: string;
    changelog: string;
    webhapp_url: string;
  }) {
    // 1. Fetch app from new source and check happ hash agains previous happ hash.
    const currentSource: WebHappSource = JSON.parse(this.toolEntity.record.entry.source);
    const currentHashes: AppHashes = JSON.parse(this.toolEntity.record.entry.hashes);
    console.log('CURRENT HASHES: ', currentHashes);

    let newHashes: AppHashes | undefined;
    let newSource: WebHappSource | undefined;

    if (fields.webhapp_url !== currentSource.url) {
      newSource = {
        type: 'https',
        url: fields.webhapp_url,
      };
      this._updating = 'Fetching new resource for validation...';
      // try to fetch (web)happ from new source to verify link
      let byteArray: number[];
      try {
        const response = await fetch(fields.webhapp_url);
        byteArray = Array.from(new Uint8Array(await response.arrayBuffer()));
      } catch (e) {
        this._updating = undefined;
        notifyError('Failed to fetch new resource at the specified URL');
        throw new Error(`Failed to fetch new resource at the specified URL: ${e}`);
      }
      // verify that new resource is of the right format (happ or webhapp) and compute the new hashes
      try {
        this._updating = 'Validating resource format and computing hashes...';
        newHashes = await validateHappOrWebhapp(byteArray);
      } catch (e) {
        this._updating = undefined;
        notifyError(`Failed to validate resources: ${e}`);
        throw new Error(`Asset format validation failed: ${e}`);
      }
      this._updating = 'Comparing hashes with previous app version...';
      if (currentHashes.type === 'happ') {
        notifyAndThrow('Updating .happ files of headless applets is currently not supported.');
      } else if (currentHashes.type === 'webhapp') {
        if (newHashes!.type !== 'webhapp') {
          this._updating = undefined;
          notifyAndThrow("Previous applet version was of type 'webhapp' but got type 'happ' now.");
          return;
        }
        if (currentHashes.happ.sha256 !== newHashes!.happ.sha256) {
          this._updating = undefined;
          notifyAndThrow(
            'happ file hash does not match with the previous version. If you want to upload an applet with a new .happ file you need to create a new App entry.',
          );
          return;
        }
      } else {
        this._updating = undefined;
        notifyAndThrow(`Got invalid app type '${(currentHashes as any).type}'`);
        return;
      }
    }

    this._updating = 'Publishing updated app entry...';

    let permissionHash;
    try {
      permissionHash = await this.mossStore.toolsLibraryStore.toolsLibraryClient.getMyPermission(
        this.developerCollectiveHash,
      );
    } catch (e) {
      notifyError(`Failed to get permission status: ${e}`);
      this._publishing = undefined;
      throw new Error(`Failed to get my permission status: ${e}`);
    }

    if (!permissionHash) {
      notifyError(`Found no valid permission to publish.`);
      this._publishing = undefined;
      throw new Error('Found no valid permission to publish.');
    }

    const updatedTool: UpdatedTool = {
      permission_hash: permissionHash,
      title: fields.title,
      subtitle: fields.subtitle,
      description: fields.description,
      icon: this._toolIconSrc ? this._toolIconSrc : this.toolEntity.record.entry.icon,
      version: fields.version,
      hashes: newHashes ? JSON.stringify(newHashes) : this.toolEntity.record.entry.hashes,
      source: newSource ? JSON.stringify(newSource) : this.toolEntity.record.entry.source,
      changelog: fields.changelog,
      meta_data: this.toolEntity.record.entry.meta_data,
      deprecation: this.toolEntity.record.entry.deprecation,
    };

    const updateEntityInput: UpdateToolInput = {
      original_tool_hash: this.toolEntity.originalActionHash,
      previous_tool_hash: this.toolEntity.record.actionHash,
      updated_tool: updatedTool,
    };
    try {
      await this.mossStore.toolsLibraryStore.toolsLibraryClient.updateTool(updateEntityInput);
      this.dispatchEvent(new CustomEvent('tool-updated', { bubbles: true, composed: true }));
    } catch (e) {
      notifyError('Failed to update app (see Console for details).');
      throw e;
    }
    this._updating = undefined;
    notify('Tool updated.');
  }

  renderUpdateTool() {
    return html`
      <div class="column" style="align-items: center;">
        <div class="title" style="margin-bottom: 40px; margin-top: 10px;">
          ${msg('Update Tool')}
        </div>
        <form id="form" ${onSubmit((fields) => this.updateTool(fields))}>
          <div class="column" style="align-items: center; min-width: 600px;">
            <input
              type="file"
              id="update-tool-icon-file-picker"
              style="display: none"
              accept="image/*"
              @change=${this.onUpdateToolIconUploaded}
            />
            ${html` <img
              tabindex="0"
              @click=${() => this._udpateToolIconFilePicker.click()}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  this._udpateToolIconFilePicker.click();
                }
              }}
              src=${this._toolIconSrc ? this._toolIconSrc : this.toolEntity.record.entry.icon}
              alt="Applet Icon"
              class="icon-picker"
            />`}
            </div>
            <sl-input
              name="title"
              .value=${this.toolEntity.record.entry.title}
              required
              .placeholder=${msg('Title')}
              @input=${(e) => {
                if (!e.target.value || e.target.value.length < 1) {
                  e.target.setCustomValidity('Tool title must not be empty.');
                } else {
                  e.target.setCustomValidity('');
                }
              }}
              style="margin-bottom: 10px; width: 600px;"
            ></sl-input>
            <sl-input
              name="subtitle"
              .value=${this.toolEntity.record.entry.subtitle}
              required
              .placeholder=${msg('Subtitle')}
              @input=${(e) => {
                if (!e.target.value || e.target.value.length < 1) {
                  e.target.setCustomValidity('Tool subtitle must not be empty.');
                } else if (e.target.value.length > 80) {
                  e.target.setCustomValidity('Subtitle is too long.');
                } else {
                  e.target.setCustomValidity('');
                }
              }}
              style="margin-bottom: 10px; width: 600px;"
            ></sl-input>
            <sl-textarea
              name="description"
              .value=${this.toolEntity.record.entry.description}
              required
              .placeholder=${msg('Description')}
              @input=${(e) => {
                if (!e.target.value || e.target.value.length < 1) {
                  e.target.setCustomValidity('Tool description must not be empty.');
                } else if (e.target.value.length > 5000) {
                  e.target.setCustomValidity('Description is too long.');
                } else {
                  e.target.setCustomValidity('');
                }
              }}
              style="margin-bottom: 10px; width: 600px;"
            ></sl-textarea>

            <sl-input
              name="version"
              required
              .placeholder=${msg('Version')}
              @input=${(e) => {
                if (!e.target.value || e.target.value.length < 1) {
                  e.target.setCustomValidity('Tool version must not be empty.');
                } else if (e.target.value.length > 20) {
                  e.target.setCustomValidity('Version is too long.');
                } else {
                  e.target.setCustomValidity('');
                }
              }}
              style="margin-bottom: 10px; width: 600px;"
            ></sl-input>
            <sl-textarea
              name="changelog"
              .value=${this.toolEntity.record.entry.changelog}
              required
              .placeholder=${msg('Changelog')}
              style="margin-bottom: 10px; width: 600px;"
            ></sl-textarea>
            <sl-input
              name="webhapp_url"
              required
              .placeholder=${msg('URL to webhapp release asset (Github, Gitlab, ...)')}
              @input=${(e) => {
                if (!e.target.value || e.target.value === '') {
                  e.target.setCustomValidity('URL to webhapp asset is required.');
                } else if (!e.target.value.startsWith('https://')) {
                  e.target.setCustomValidity('URL must start with https://');
                } else {
                  e.target.setCustomValidity('');
                }
              }}
              style="margin-bottom: 10px; width: 600px;"
            ></sl-input>
            <div>${this._updating}</div>
            <div class="row" style="margin-top: 40px; justify-content: center;">
              <sl-button
                variant="danger"
                style="margin-right: 10px;"
                @click=${() => {
                  this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
                }}
                @keypress=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter') {
                    this.dispatchEvent(
                      new CustomEvent('cancel', { bubbles: true, composed: true }),
                    );
                  }
                }}
                >${msg('Cancel')}
              </sl-button>
              <sl-button .loading=${!!this._updating} variant="primary" type="submit">${msg(
                'Update',
              )} </sl-button>
            </div>
          </div>
        </form>
      </div>
    `;
  }

  render() {
    return html`
      <div class="column flex-scrollable-y" style="padding: 16px; flex: 1">
        ${this.renderUpdateTool()}
      </div>
    `;
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

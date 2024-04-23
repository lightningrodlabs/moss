import { html, LitElement, css } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { hashProperty, notify, notifyError, onSubmit } from '@holochain-open-dev/elements';

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
import { ActionHash } from '@holochain/client';
import { resizeAndExport } from '../../utils.js';
import { AppHashes, WebHappSource } from '../../types.js';
import { validateHappOrWebhapp } from '../../electron-api.js';
import { Tool } from '../../tools-library/types.js';

@localized()
@customElement('publish-tool')
export class PublishTool extends LitElement {
  @consume({ context: mossStoreContext })
  mossStore!: MossStore;

  @property(hashProperty('developer-collective-hash'))
  developerCollectiveHash!: ActionHash;

  @state()
  _toolIconSrc: string | undefined;

  @state()
  _updatedFields: {
    icon_src: string | undefined;
    title: string | undefined;
    subtitle: string | undefined;
    description: string | undefined;
    webhapp_url: string | undefined;
  } = {
    icon_src: undefined,
    title: undefined,
    subtitle: undefined,
    description: undefined,
    webhapp_url: undefined,
  };

  @state()
  _publishing: string | undefined = undefined;

  @state()
  _updating: string | undefined = undefined;

  @query('#icon-file-picker')
  private _appletIconFilePicker!: HTMLInputElement;

  onAppletIconUploaded() {
    if (this._appletIconFilePicker.files && this._appletIconFilePicker.files[0]) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          this._toolIconSrc = resizeAndExport(img);
          this._appletIconFilePicker.value = '';
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(this._appletIconFilePicker.files[0]);
    }
  }

  async publishTool(fields: {
    title: string;
    subtitle: string;
    description: string;
    version: string;
    webhapp_url: string;
  }) {
    this._publishing = 'Fetching resource for validation...';
    console.log('TRYING TO PUBLISH TOOL...');
    if (!this._toolIconSrc) {
      this._publishing = undefined;
      notifyError('No Icon provided.');
      throw new Error('Icon is required.');
    }
    // try to fetch (web)happ from source to verify link
    let byteArray: number[];
    try {
      const response = await fetch(fields.webhapp_url);
      byteArray = Array.from(new Uint8Array(await response.arrayBuffer()));
    } catch (e) {
      this._publishing = undefined;
      notifyError('Failed to fetch resource at the specified URL');
      throw new Error(`Failed to fetch resource at the specified URL: ${e}`);
    }
    // verify that resource is of the right format (happ or webhapp) and compute the hashes
    let hashes: AppHashes;
    try {
      this._publishing = 'Validating resource format and computing hashes...';
      hashes = await validateHappOrWebhapp(byteArray);
    } catch (e) {
      this._publishing = undefined;
      notifyError(
        `Asset format validation failed. Make sure the URL points to a valid .webhapp or .happ file.`,
      );
      throw new Error(`Asset format validation failed: ${e}`);
    }

    const source: WebHappSource = {
      type: 'https',
      url: fields.webhapp_url,
    };

    // TODO try to fetch webhapp, check that it's a valid webhapp and compute hashes

    const payload: Tool = {
      developer_collective: this.developerCollectiveHash,
      permission_hash: this.developerCollectiveHash, // TODO fix in case of publisher is not owner
      title: fields.title,
      subtitle: fields.subtitle,
      description: fields.description,
      icon: this._toolIconSrc,
      version: fields.version,
      source: JSON.stringify(source),
      hashes: JSON.stringify(hashes),
      changelog: undefined,
      meta_data: undefined,
      deprecation: undefined,
    };

    console.log('got payload: ', payload);
    const _toolRecord =
      await this.mossStore.toolsLibraryStore.toolsLibraryClient.createTool(payload);
    this._toolIconSrc = undefined;
    this._publishing = undefined;
    notify('Tool published.');
    this.dispatchEvent(new CustomEvent('tool-published', { bubbles: true, composed: true }));
  }

  renderPublishApplet() {
    return html`
      <div class="column" style="align-items: center;">
        <div class="title" style="margin-bottom: 40px; margin-top: 30px;">
          ${msg('Publish New Tool')}
        </div>
        <form id="form" ${onSubmit((fields) => this.publishTool(fields))}>
          <div class="column" style="align-items: center; min-width: 600px;">
            <input
              type="file"
              id="icon-file-picker"
              style="display: none"
              accept="image/*"
              @change=${this.onAppletIconUploaded}
            />
            ${
              this._toolIconSrc
                ? html`<img
                    tabindex="0"
                    @click=${() => this._appletIconFilePicker.click()}
                    @keypress=${(e: KeyboardEvent) => {
                      if (e.key === 'Enter') {
                        this._appletIconFilePicker.click();
                      }
                    }}
                    src=${this._toolIconSrc}
                    alt="Applet Icon"
                    class="icon-picker"
                  />`
                : html`<div
                    tabindex="0"
                    @click=${() => this._appletIconFilePicker.click()}
                    @keypress=${(e: KeyboardEvent) => {
                      if (e.key === 'Enter') {
                        this._appletIconFilePicker.click();
                      }
                    }}
                    class="column center-content icon-picker picker-btn"
                    style="font-size: 34px;height: 200px; width: 200px; border-radius: 40px;"
                  >
                    + Add Icon
                  </div>`
            }
            </div>
            <sl-input
              name="title"
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
              name="description"
              required
              .placeholder=${msg('Description')}
              @input=${(e) => {
                if (!e.target.value || e.target.value.length < 1) {
                  e.target.setCustomValidity('Applet description must not be empty.');
                } else if (e.target.value.length > 5000) {
                  e.target.setCustomValidity('Description is too long.');
                } else {
                  e.target.setCustomValidity('');
                }
              }}
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
            <div>${this._publishing}</div>
            <div class="row" style="margin-top: 40px; justify-content: center;">
              <sl-button
                variant="danger"
                style="margin-right: 10px;"
                @click=${() => {
                  this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
                }}
                @keypress=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    this.dispatchEvent(
                      new CustomEvent('cancel', { bubbles: true, composed: true }),
                    );
                  }
                }}
                >${msg('Cancel')}
              </sl-button>
              <sl-button .loading=${!!this._publishing} variant="primary" type="submit">${msg(
                'Publish',
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
        ${this.renderPublishApplet()}
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

import { css, html, LitElement } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { msg } from '@lit/localize';
import '@shoelace-style/shoelace/dist/components/avatar/avatar.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import { mdiPlus } from '@mdi/js';

import { resizeAndExportImg } from '../../utils.js';
import { FormField, FormFieldController, wrapPathInSvg } from '@holochain-open-dev/elements';
import { weStyles } from '../../shared-styles.js';
import { plusIcon } from './icons.js';

@customElement('moss-select-avatar')
export class MossSelectAvatar extends LitElement implements FormField {
  @property({ attribute: 'name' })
  name: string = 'avatar';

  @property()
  required: boolean = false;

  @property()
  shape: 'circle' | 'square' | 'rounded' = 'circle';

  @property()
  value: string | undefined;

  @property()
  disabled: boolean = false;

  @property()
  defaultValue: string | undefined;

  @property()
  label: string = msg('Avatar');

  @query('#avatar-file-picker')
  private _avatarFilePicker!: HTMLInputElement;

  @query('#error-input')
  private _errorInput!: HTMLInputElement;

  _controller = new FormFieldController(this);

  reportValidity() {
    const invalid = this.required !== false && !this.value;
    if (invalid) {
      this._errorInput.setCustomValidity('Avatar is required');
      this._errorInput.reportValidity();
    }

    return !invalid;
  }

  reset() {
    this.value = this.defaultValue;
  }

  onAvatarUploaded() {
    if (this._avatarFilePicker.files && this._avatarFilePicker.files[0]) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          this.value = resizeAndExportImg(img);
          this._avatarFilePicker.value = '';
        };
        img.src = e.target?.result as string;

        this.dispatchEvent(
          new CustomEvent('avatar-selected', {
            composed: true,
            bubbles: true,
            detail: {
              avatar: img.src,
            },
          }),
        );
      };
      reader.readAsDataURL(this._avatarFilePicker.files[0]);
    }
  }

  renderAvatar() {
    if (this.value)
      return html`
        <img
          class="image-picker-img"
          alt=${this.label ? this.label : 'image picker'}
          @click=${() => {
            this.value = undefined;
          }}
          src=${this.value}
        />
      `;
    else
      return html` <div class="column" style="align-items: center;">
        <button
          class="image-picker-button"
          .disabled=${this.disabled}
          @click=${() => this._avatarFilePicker.click()}
        >
          ${plusIcon()}
        </button>
      </div>`;
  }

  render() {
    return html`<input
        type="file"
        id="avatar-file-picker"
        style="display: none"
        @change=${this.onAvatarUploaded}
      />
      <div class="column" style="position: relative; align-items: center">
        <input
          id="error-input"
          style="position: absolute; z-index: -1; left: 50%; top: 30px; height: 0; width: 0"
        />
        ${this.label !== ''
          ? html`
              <span style="font-size: var(--sl-input-label-font-size-medium); margin-bottom: 4px"
                >${this.label}${this.required !== false ? ' *' : ''}</span
              >
            `
          : html``}
        ${this.renderAvatar()}
      </div>`;
  }

  static styles = weStyles;
}

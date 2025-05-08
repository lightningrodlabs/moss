import { css, html, LitElement } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { msg } from '@lit/localize';
import '@shoelace-style/shoelace/dist/components/avatar/avatar.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

import { resizeAndExportImg } from '../../utils.js';
import { FormField, FormFieldController } from '@holochain-open-dev/elements';
import { weStyles } from '../../shared-styles.js';
import { plusIcon } from './icons.js';

@customElement('moss-select-avatar')
export class MossSelectAvatar extends LitElement implements FormField {
  @property({ attribute: 'name' })
  name: string = 'avatar';

  @property()
  required: boolean = false;

  @property({ attribute: 'reset-on-click' })
  resetOnClick: boolean = false;

  @property()
  shape: 'circle' | 'square' | 'rounded' = 'circle';

  @property()
  disabled: boolean = false;

  @property()
  defaultValue: string | undefined;

  @property()
  label: string = msg('Choose Profile Picture');

  @query('#avatar-file-picker')
  private _avatarFilePicker!: HTMLInputElement;

  @query('#error-input')
  private _errorInput!: HTMLInputElement;

  @state()
  value: string | undefined;

  reset() {
    this.value = this.defaultValue;
  }

  _controller = new FormFieldController(this);

  reportValidity() {
    const invalid = this.required !== false && !this.value;
    if (invalid) {
      this._errorInput.setCustomValidity('Avatar is required');
      this._errorInput.reportValidity();
    }

    return !invalid;
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
          this.dispatchEvent(
            new CustomEvent('avatar-selected', {
              composed: true,
              bubbles: true,
              detail: {
                avatar: this.value,
              },
            }),
          );
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(this._avatarFilePicker.files[0]);
    }
  }

  renderAvatar() {
    if (this.value)
      return html`
        <img
          class="image-picker-img ${this.shape === 'rounded' ? 'rounded' : ''}"
          alt=${this.label ? this.label : 'image picker'}
          src=${this.value}
          @click=${() => {
            if (this.resetOnClick) {
              this.value = '';
              this.dispatchEvent(
                new CustomEvent('avatar-selected', {
                  composed: true,
                  bubbles: true,
                  detail: {
                    avatar: '',
                  },
                }),
              );
            } else {
              this._avatarFilePicker.click();
            }
          }}
        />
      `;
    else
      return html` <div class="column" style="align-items: center;">
        <button
          class="image-picker-button ${this.shape === 'rounded' ? 'rounded' : ''}"
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
        <sl-tooltip placement="bottom" content="${msg(this.label)}">
          ${this.renderAvatar()}
        </sl-tooltip>
      </div>`;
  }

  static styles = [
    weStyles,
    css`
      .image-picker-button {
        all: unset;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        height: 80px;
        width: 80px;
        cursor: pointer;
        border: 1px solid #778355;
        background-color: var(--moss-light-green);
      }

      .image-picker-img {
        border-radius: 50%;
        height: 80px;
        width: 80px;
        cursor: pointer;
        border: 1px solid #778355;
        background-color: #4c6a3961;
      }

      .icon-btn {
        all: unset;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        width: 24px;
        height: 24px;
        cursor: pointer;
        background: #e0eed5;
      }

      .grey {
        background: var(--moss-grey-light);
      }

      .rounded {
        border-radius: 12px;
      }
    `,
  ];
}

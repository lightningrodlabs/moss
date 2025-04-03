import { css, html, LitElement } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { msg } from '@lit/localize';
import '@shoelace-style/shoelace/dist/components/avatar/avatar.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import { resizeAndExportImg } from '../../utils.js';
import { FormField, FormFieldController } from '@holochain-open-dev/elements';
import { weStyles } from '../../shared-styles.js';
import { editIcon, plusIcon, rebootIcon, trashIcon } from './icons.js';

@customElement('moss-select-avatar')
export class MossSelectAvatar extends LitElement implements FormField {
  @property({ attribute: 'name' })
  name: string = 'avatar';

  @property()
  required: boolean = false;

  @property()
  shape: 'circle' | 'square' | 'rounded' = 'circle';

  @property()
  disabled: boolean = false;

  @property()
  defaultImgs: string[] | undefined;

  @property()
  label: string = msg('Avatar');

  @query('#avatar-file-picker')
  private _avatarFilePicker!: HTMLInputElement;

  @query('#error-input')
  private _errorInput!: HTMLInputElement;

  @state()
  value: string | undefined;

  @state()
  private _hoverImage = false;

  _controller = new FormFieldController(this);

  reportValidity() {
    const invalid = this.required !== false && !this.value;
    if (invalid) {
      this._errorInput.setCustomValidity('Avatar is required');
      this._errorInput.reportValidity();
    }

    return !invalid;
  }

  firstUpdated() {
    // If default images are passed, choose a random one to start with
    if (this.defaultImgs) this.reset();
  }

  reset() {
    if (this.defaultImgs) {
      // Randomly select one of the default images
      const randomIndex = Math.floor(Math.random() * this.defaultImgs.length);
      this.value = this.defaultImgs[randomIndex];
    } else {
      this.value = undefined;
    }
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
          src=${this.value}
          @mouseenter=${() => {
            this._hoverImage = true;
          }}
        />
        <div
          class="overlay column center-content"
          style="${this._hoverImage ? '' : 'display: none;'}"
          @mouseleave=${() => {
            this._hoverImage = false;
          }}
          @click=${() => this._avatarFilePicker.click()}
        >
          ${editIcon(20)}
        </div>
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
        <sl-tooltip placement="bottom" content=${msg('Change Group Icon')}>
          ${this.renderAvatar()}
        </sl-tooltip>
        <div class="column center-content" style="position: absolute; right: -28px; bottom: 1px;">
          <!-- <sl-tooltip content=${msg('Clear')}>
            <button class="icon-btn grey" style="margin-bottom: 4px;">${trashIcon()}</button>
          </sl-tooltip> -->
          <sl-tooltip content=${msg('random image')} placement="right">
            <button class="icon-btn" @click=${() => this.reset()}>${rebootIcon()}</button>
          </sl-tooltip>
        </div>
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
        border-radius: 12px;
        height: 80px;
        width: 80px;
        cursor: pointer;
        border: 1px solid #778355;
        background-color: var(--moss-light-green);
      }

      .image-picker-img {
        border-radius: 12px;
        height: 80px;
        width: 80px;
        cursor: pointer;
        border: 1px solid transparent;
      }

      .overlay {
        position: absolute;
        border-radius: 12px;
        height: 80px;
        width: 80px;
        background: #000000a9;
        cursor: pointer;
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
    `,
  ];
}

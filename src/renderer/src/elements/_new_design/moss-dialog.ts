import { css, html, LitElement } from 'lit';
import { query, customElement, property } from 'lit/decorators.js';
import { localized } from '@lit/localize';

import '@holochain-open-dev/elements/dist/elements/select-avatar.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/radio-group/radio-group.js';
import '@shoelace-style/shoelace/dist/components/radio/radio.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import { mossStyles } from '../../shared-styles.js';
import { closeIcon } from './icons.js';


/**
 * @element moss-dialog
 */
@localized()
@customElement('moss-dialog')
export class MossDialog extends LitElement {
  async show() {
    this._dialog.show();
  }
  async hide() {
    this._dialog.hide();
  }
  @property()
  width = ""

  @property()
  class = ""

  @property()
  styles = ""

  @property()
  noHeader = false

  @property()
  headerAlign = "left"

  /** Private properties */
  @query('#dialog')
  _dialog!: SlDialog;

  firstUpated() {
    // this._dialog.show();
  }

  render() {
    return html`
      <sl-dialog class="defaults moss-dialog ${this.class}" id="dialog" no-header style="${this.styles ? `${this.styles};` : ``}${this.width ? ` --width: ${this.width};` : ''}">
        <div class="column" style="position: relative">
          <button
            class="moss-dialog-close-button"
            style="position: absolute; top: -12px; right: -12px;"
            @click=${() => {
        this._dialog?.hide();
      }}
               >
            ${closeIcon(24)}
          </button>
        </div>
        <div class="column flex-1 dialog-content" style="padding: 40px 100px;">
                ${this.noHeader ? '' :
        html`<div class="dialog-title" style="text-align: ${this.headerAlign}; margin-bottom: 20px;"><slot name="header"><slot></div>`
      }
          <slot name="content"></slot>
        </div>
      </sl-dialog>
    `;
  }

  static styles = [mossStyles, css` 
    .defaults {
      --width: 1024px;
    }    
    .profile-detail-popup {
      --width: 400px;
      --height: 446px;
    }
    .gradient::part(panel) {
      background: linear-gradient(180deg, var(--Moss-main-green, #e0eed5) 18.05%, #f5f5f3 99.92%);
    }
    .library-tool-details-dialog::part(panel) {
      margin-top: 130px;
      max-height: calc(100vh - 158px);
      max-width: calc(100vw - 128px);
      width: min(var(--width, 1024px), calc(100vw - 128px));
      display: flex;
      flex-direction: column;
      position: fixed !important;
      left: clamp(100px, calc(100px + (100vw - 128px - min(var(--width, 1024px), calc(100vw - 128px))) / 2), calc(100vw - 28px - min(var(--width, 1024px), calc(100vw - 128px)))) !important;
      transform: none !important;
      right: auto !important;
      margin-left: 0 !important;
    }
    .dialog-content {
      overflow-y: auto;
      flex: 1;
      min-height: 0;
      overflow-x: hidden;
    }
`];
}

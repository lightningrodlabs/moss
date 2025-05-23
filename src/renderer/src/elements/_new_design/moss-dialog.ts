import { css, html, LitElement } from 'lit';
import { query, customElement } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@holochain-open-dev/elements/dist/elements/select-avatar.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/radio-group/radio-group.js';
import '@shoelace-style/shoelace/dist/components/radio/radio.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import { mossStyles } from '../../shared-styles.js';

import './moss-input.js';
import './moss-select-avatar.js';
import { arrowLeftShortIcon } from './icons.js';
import { defaultIcons } from './defaultIcons.js';

/**
 * @element create-group-dialog
 */
@localized()
@customElement('moss-dialog')
export class MossDialog extends LitElement {
  async open() {
    this._dialog.show();
  }

  /** Private properties */
  @query('#dialog')
  _dialog!: SlDialog;

  firstUpated() {
    // this._dialog.show();
  }

  render() {
    return html`
      <sl-dialog id="dialog" no-header class="moss-dialog" style="--width: 670px;">
        <button class="moss-hover-icon-button" style="margin-left: -8px; margin-top: -8px;">
          <div class="row items-center">
            <div class="moss-hover-icon-button-icon" style="margin-right: 10px;">
              ${arrowLeftShortIcon(24)}
            </div>
            <div class="moss-hover-icon-button-text">${msg('back')}</div>
          </div>
        </button>
        <div class="column items-center">
          <span
            style="font-size: 28px; font-weight: 500; margin-bottom: 48px; margin-top: 30px; letter-spacing: -0.56px;"
            >My group is called</span
          >

          <sl-input
            class="moss-input"
            placeholder=${msg('group name')}
            label=${msg('group name')}
            size="medium"
            style="margin-bottom: 20px; width: 350px;"
          >
          </sl-input>

          <moss-select-avatar
            label=""
            .defaultImgs=${defaultIcons}
            style="margin-bottom: 56px;"
          ></moss-select-avatar>

          <!-- <sl-input
            class="moss-input"
            type="password"
            placeholder=${msg('your password')}
            label=${msg('your password')}
            size="medium"
            style="margin-bottom: 20px;"
            password-toggle
          ></sl-input> -->

          <button class="moss-button" disabled style="width: 310px; margin-bottom: 56px;">
            Next
          </button>

          <div class="row">
            <div class="dialog-dot" style="margin-right: 20px;"></div>
            <div class="dialog-dot bg-black"></div>
          </div>
        </div>
      </sl-dialog>
    `;
  }

  static styles = [
    mossStyles,
    css`
      sl-dialog {
        /* --sl-panel-background-color: var(--sl-color-primary-0); */
      }
    `,
  ];
}

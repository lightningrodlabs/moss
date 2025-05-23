import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import { SlDialog } from '@shoelace-style/shoelace';

import { mossStyles } from '../../shared-styles.js';

@customElement('loading-dialog')
export class LoadingDialog extends LitElement {
  @property()
  loadingText: string = 'Loading...';

  show() {
    (this.shadowRoot!.getElementById('loading-dialog') as SlDialog).show();
  }

  hide() {
    (this.shadowRoot!.getElementById('loading-dialog') as SlDialog).hide();
  }

  render() {
    return html`
      <sl-dialog
        id="loading-dialog"
        @sl-request-close=${(e) => {
          e.preventDefault();
        }}
        no-header
      >
        <div class="column center-content">
          <sl-spinner style="font-size: 30px;"></sl-spinner>
          <div style="margin-top: 30px;">${this.loadingText}</div>
        </div>
      </sl-dialog>
    `;
  }

  static get styles() {
    return [
      mossStyles,
      css`
        :host {
          display: flex;
        }
      `,
    ];
  }
}

import { customElement } from 'lit/decorators.js';
import { css, html, LitElement } from 'lit';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/button/button.js';

import { mossStyles } from '../../../shared-styles.js';

@localized()
@customElement('moss-danger-zone-settings')
export class MossDangerZoneSettings extends LitElement {
  render() {
    return html`
      <div class="column" style="margin-top: 40px;">
        <div><b>${msg('Factory Reset')}</b></div>
        <div
          class="row items-center"
          style="background: #ffaaaa; padding: 10px 15px; border-radius: 8px; margin-top: 12px;"
        >
          <span style="margin-right: 20px; flex: 1;">
            ${msg('Fully reset Moss and')} <b>${msg('delete all associated data')}</b>
          </span>
          <sl-button
            variant="danger"
            @click=${async () => await window.electronAPI.factoryReset()}
          >
            ${msg('Factory Reset')}
          </sl-button>
        </div>
      </div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: flex;
      }
    `,
  ];
}

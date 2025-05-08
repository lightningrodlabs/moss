import { notify } from '@holochain-open-dev/elements';
import { localized, msg } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

/**
 * @element create-group-dialog
 */
@localized()
@customElement('copy-hash')
export class CopyHash extends LitElement {
  @property()
  hash!: string;

  render() {
    return html` <sl-tooltip content=${msg('click to copy')}>
      <div
        class="copy-hash"
        @click=${async () => {
          await navigator.clipboard.writeText(this.hash);
          notify(msg('Hash copied to clipboard.'));
        }}
      >
        ${this.hash}
      </div>
    </sl-tooltip>`;
  }

  static styles = [
    css`
      .copy-hash {
        font-size: 12px;
        background: var(--moss-field-grey);
        border-radius: 4px;
        padding: 5px 8px 3px 8px;
        cursor: pointer;
      }
    `,
  ];
}

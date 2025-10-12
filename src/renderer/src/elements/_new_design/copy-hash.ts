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

  @property()
  tooltipText: string = msg('click to copy');

  @property({ type: Boolean })
  shortened: boolean = false;

  render() {
    return html` <sl-tooltip content=${this.tooltipText}>
      <div
        class="copy-hash"
        @click=${async () => {
          await navigator.clipboard.writeText(this.hash);
          notify(msg('Hash copied to clipboard.'));
        }}
      >
        ${this.shortened ? `${this.hash.slice(0, 8)}...${this.hash.slice(-8)}` : this.hash}
      </div>
    </sl-tooltip>`;
  }

  static styles = [
    css`
      .copy-hash {
        font-size: 12px;
        background: rgba(119, 131, 85, 0.2);
        color: var(--moss-hint-green);
        border-radius: 4px;
        padding: 5px 8px 3px 8px;
        cursor: pointer;
        text-align: center;
      }
    `,
  ];
}

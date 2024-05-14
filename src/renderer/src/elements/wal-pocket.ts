import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tag/tag.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';

import { WAL } from '@lightningrodlabs/we-applet';
import { WeaveClient, WeaveServices } from '@lightningrodlabs/we-applet';
import { sharedStyles } from '@holochain-open-dev/elements';
import { weaveClientContext } from '@lightningrodlabs/we-elements';

@localized()
@customElement('wal-pocket')
export class WalPocket extends LitElement {
  @property()
  wal!: WAL;

  @consume({ context: weaveClientContext, subscribe: true })
  weaveClient!: WeaveClient | WeaveServices;

  async walToPocket() {
    await this.weaveClient.walToPocket(this.wal);
  }

  render() {
    return html`
      <sl-tooltip content="${msg('Add to Pocket')}">
        <div
          class="row btn"
          tabindex="0"
          @click=${() => this.walToPocket()}
          @keypress=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              this.walToPocket();
            }
          }}
        >
          <img src="pocket_white.png" style="height: 35px; fill-color: white;" />
        </div>
      </sl-tooltip>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      /* .container {
        --bg-color: var(--bg-color);
        --bg-color-hover: var(--bg-color-hover);
      } */
      .btn {
        align-items: center;
        justify-content: center;
        background: var(--bg-color, white);
        padding: 9px;
        border-radius: 50%;
        box-shadow: 1px 1px 3px #6b6b6b;
        cursor: pointer;
      }

      .btn:hover {
        background: var(--bg-color-hover, #e4e4e4);
      }
    `,
  ];
}

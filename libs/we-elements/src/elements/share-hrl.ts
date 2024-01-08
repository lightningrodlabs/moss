import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';

import { encodeHashToBase64 } from '@holochain/client';
import { notify, sharedStyles, wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiShareVariantOutline } from '@mdi/js';

import { HrlWithContext } from '@lightningrodlabs/we-applet';

@localized()
@customElement('share-hrl')
export class ShareHrl extends LitElement {
  @property()
  hrlWithContext!: HrlWithContext;

  async copyHrl() {
    let url = `https://lightningrodlabs.org/we?we://hrl/${encodeHashToBase64(
      this.hrlWithContext.hrl[0],
    )}/${encodeHashToBase64(this.hrlWithContext.hrl[1])}`;
    if (this.hrlWithContext.context) {
      url = `${url}?context=${JSON.stringify(this.hrlWithContext.context)}`;
    }
    await navigator.clipboard.writeText(url);

    notify(msg('Link copied.'));
  }

  render() {
    return html`
      <sl-tooltip .content=${msg('Share')}>
        <div
          class="row btn"
          tabindex="0"
          @click=${() => this.copyHrl()}
          @keypress=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              this.copyHrl();
            }
          }}
        >
          <sl-icon
            .src=${wrapPathInSvg(mdiShareVariantOutline)}
            style="padding-right: 10%;"
          ></sl-icon>
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

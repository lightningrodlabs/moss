import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

import { consume } from "@lit-labs/context";
import { localized, msg } from "@lit/localize";

import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import "@shoelace-style/shoelace/dist/components/skeleton/skeleton.js";
import "@shoelace-style/shoelace/dist/components/tag/tag.js";
import "@shoelace-style/shoelace/dist/components/tooltip/tooltip.js";
import "@holochain-open-dev/elements/dist/elements/display-error.js";

import { lazyLoad, StoreSubscriber } from "@holochain-open-dev/stores";

import { weClientContext } from "../context";
import { Hrl } from "../types";
import { WeClient } from "../api";
import { getAppletsInfosAndGroupsProfiles } from "../utils";
import { sharedStyles, wrapPathInSvg } from "@holochain-open-dev/elements";
import { mdiNotePlusOutline } from "@mdi/js";

@localized()
@customElement("hrl-to-clipboard")
export class HrlToClipboard extends LitElement {
  @property()
  hrl!: Hrl;

  @property()
  context: any = {};

  @consume({ context: weClientContext, subscribe: true })
  weClient!: WeClient;

  async hrlToClipboard() {
    await this.weClient.hrlToClipboard({
      hrl: this.hrl,
      context: this.context,
    });
  }

  render() {
    return html`
      <sl-tooltip content="Add to Clipboard">
        <div
          class="row btn"
          tabindex="0"
          @click=${() => this.hrlToClipboard()}
          @keypress=${(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              this.hrlToClipboard()}
            }
          }
        >
          <sl-icon .src=${wrapPathInSvg(mdiNotePlusOutline)}></sl-icon>
        </div>
      </sl-tooltip>
    `;
  }


  static styles = [sharedStyles,
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
    `
  ];
}

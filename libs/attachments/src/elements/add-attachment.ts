import {
  hashProperty,
  notify,
  notifyError,
  sharedStyles,
  wrapPathInSvg,
} from "@holochain-open-dev/elements";
import { consume } from "@lit-labs/context";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { mdiAttachmentPlus, mdiPaperclipPlus } from "@mdi/js";
import { msg, localized } from "@lit/localize";
import { lazyLoad, StoreSubscriber } from "@holochain-open-dev/stores";
import { AnyDhtHash, EntryHash } from "@holochain/client";

import "@holochain-open-dev/elements/dist/elements/display-error.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/skeleton/skeleton.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import "@shoelace-style/shoelace/dist/components/dropdown/dropdown.js";
import "@shoelace-style/shoelace/dist/components/tooltip/tooltip.js";
import "@shoelace-style/shoelace/dist/components/alert/alert.js";
import "@shoelace-style/shoelace/dist/components/menu/menu.js";
import "@shoelace-style/shoelace/dist/components/menu-item/menu-item.js";
import "@shoelace-style/shoelace/dist/components/menu-label/menu-label.js";
import "@shoelace-style/shoelace/dist/components/divider/divider.js";

// TODO: remove alternative menu when sl-menu includes submenus
import "@material/web/menu/menu.js";
import "@material/web/menu/sub-menu-item.js";
import "@material/web/menu/menu-item.js";

import {
  weClientContext,
  WeClient,
} from "@lightningrodlabs/we-applet";
import { HoloHashMap } from "@holochain-open-dev/utils";

import { AttachmentsStore } from "../attachments-store";
import { attachmentsStoreContext } from "../context";

@localized()
@customElement("add-attachment")
export class AddAttachment extends LitElement {
  @consume({ context: attachmentsStoreContext, subscribe: true })
  attachmentsStore!: AttachmentsStore;

  @consume({ context: weClientContext, subscribe: true })
  weClient!: WeClient;

  @property(hashProperty("hash"))
  hash!: AnyDhtHash;

  async addAttachment() {
    try {
      const hrlWithContext = await this.weClient.userSelectHrl();
      if (hrlWithContext) {
        await this.attachmentsStore.client.addAttachment(
          this.hash,
          hrlWithContext
        );
        notify(msg("Entry attached."));
      }
    } catch (e) {
      notifyError(msg("Error creating the attachment"));
      console.error(e);
    }
  }

  render() {
    return html`
      <sl-tooltip content="Attach existing entry">
        <div
          class="row btn"
          tabindex="0"
          @click=${() => this.addAttachment()}
          @keypress=${(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              this.addAttachment()
            }
          }}
        >
          <sl-icon .src=${wrapPathInSvg(mdiPaperclipPlus)}></sl-icon>
        </div>
      </sl-tooltip>
    `;
  }

  static styles = [sharedStyles,
    css`
      .btn {
        align-items: center;
        background: white;
        padding: 9px;
        border-radius: 50%;
        box-shadow: 1px 1px 3px #6b6b6b;
        cursor: pointer;
      }

      .btn:hover {
        background: #e4e4e4
      }
    `
  ];
}

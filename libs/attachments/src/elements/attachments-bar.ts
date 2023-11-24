import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { hashProperty, sharedStyles } from "@holochain-open-dev/elements";
import { AnyDhtHash } from "@holochain/client";

import "./attachments-list.js";
import "./create-attachment.js";
import "./add-attachment.js";
import { consume } from "@lit-labs/context";
import { AttachmentsStore } from "../attachments-store.js";
import { attachmentsStoreContext } from "../context.js";
import { weClientContext } from "../../../we-applet/dist/context.js";
import { HrlWithContext, WeClient } from "@lightningrodlabs/we-applet";
import { StoreSubscriber } from "@holochain-open-dev/stores";

@localized()
@customElement("attachments-bar")
export class AttachmentsBar extends LitElement {
  @property(hashProperty("hash"))
  hash!: AnyDhtHash;

  @consume({ context: attachmentsStoreContext, subscribe: true })
  attachmentsStore!: AttachmentsStore;

  @consume({ context: weClientContext, subscribe: true })
  weClient!: WeClient;

  attachments = new StoreSubscriber(
    this,
    () => this.attachmentsStore.attachments.get(this.hash),
    () => [this.hash]
  );

  renderAttachments(attachments: Array<HrlWithContext>) {
    if (attachments.length === 0) return html``;

    return html`
      ${attachments.map(
        (attachment) =>
          html`
            <hrl-link
              style="margin-left: 8px"
              .hrl=${attachment.hrl}
              .context=${attachment.context}
            ></hrl-link>
          `
      )}
    `;
  }

  renderAttachmentsBar() {
    switch (this.attachments.value.status) {
      case "pending":
        return html`<sl-skeleton
            style="width: 32px; height: 32px; margin-right: 8px"
          ></sl-skeleton
          ><sl-skeleton
            style="width: 32px; height: 32px; margin-right: 8px"
          ></sl-skeleton
          ><sl-skeleton
            style="width: 32px; height: 32px; margin-right: 8px"
          ></sl-skeleton>`;
      case "complete":
        return this.renderAttachments(this.attachments.value.value);
      case "error":
        return html`<display-error
          tooltip
          .headline=${msg("Error fetching the attachments")}
          .error=${this.attachments.value.error}
        ></display-error>`;
    }
  }

  render() {
    return html`
      <div class="row" style="align-items: center">
        ${this.renderAttachmentsBar()}
        <add-attachment .hash=${this.hash}></add-attachment>
        <create-attachment .hash=${this.hash}></create-attachment>
      </div>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
      }
    `,
  ];
}

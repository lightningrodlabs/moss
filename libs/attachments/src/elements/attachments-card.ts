import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { hashProperty, sharedStyles } from "@holochain-open-dev/elements";
import { AnyDhtHash } from "@holochain/client";

import "@shoelace-style/shoelace/dist/components/card/card.js";

import "./attachments-list.js";
import "./create-attachment.js";
import "./add-attachment.js";

@localized()
@customElement("attachments-card")
export class AttachmentsCard extends LitElement {
  @property(hashProperty("hash"))
  hash!: AnyDhtHash;

  render() {
    return html`
      <sl-card style="flex: 1">
        <div class="column">
          <div class="row" style="align-items: center; margin-bottom: 20px;" slot="header">
            <span style="flex: 1; margin-right: 20px;" class="title">${msg("Attachments")}</span>

            <add-attachment .hash=${this.hash} style="margin-right: 4px;"></add-attachment>
            <create-attachment .hash=${this.hash}></create-attachment>
          </div>
          <attachments-list .hash=${this.hash} style="flex: 1"></attachments-list>
        </div>
      </sl-card>
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

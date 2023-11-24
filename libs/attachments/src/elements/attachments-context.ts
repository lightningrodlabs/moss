import { css, html, LitElement } from "lit";
import { provide } from "@lit-labs/context";
import { customElement, property } from "lit/decorators.js";

import { attachmentsStoreContext } from "../context.js";
import { AttachmentsStore } from "../attachments-store.js";

@customElement("attachments-context")
export class AttachmentsContext extends LitElement {
  @provide({ context: attachmentsStoreContext })
  @property({ type: Object })
  store!: AttachmentsStore;

  render() {
    return html`<slot></slot>`;
  }

  static styles = css`
    :host {
      display: contents;
    }
  `;
}

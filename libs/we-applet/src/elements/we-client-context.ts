import { css, html, LitElement } from "lit";
import { provide } from "@lit-labs/context";
import { customElement, property } from "lit/decorators.js";

import { weClientContext } from "../context.js";
import { WeClient, WeServices } from "../api.js";

@customElement("we-client-context")
export class WeClientContext extends LitElement {
  @provide({ context: weClientContext })
  @property({ type: Object })
  weClient!: WeClient | WeServices;

  render() {
    return html`<slot></slot>`;
  }

  static styles = css`
    :host {
      display: contents;
    }
  `;
}

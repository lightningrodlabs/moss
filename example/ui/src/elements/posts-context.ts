import { css, html, LitElement } from "lit";
import { provide } from "@lit-labs/context";
import { property, customElement } from "lit/decorators.js";

import { postsStoreContext } from "../context.js";
import { PostsStore } from "../posts-store.js";

@customElement("posts-context")
export class PostsContext extends LitElement {
  @provide({ context: postsStoreContext })
  @property({ type: Object })
  store!: PostsStore;

  render() {
    return html`<slot></slot>`;
  }

  static styles = css`
    :host {
      display: contents;
    }
  `;
}

import { LitElement, html } from "lit";
import { state, property, customElement } from "lit/decorators.js";
import { ActionHash } from "@holochain/client";
import { EntryRecord } from "@holochain-open-dev/utils";
import { StoreSubscriber } from "@holochain-open-dev/stores";
import {
  sharedStyles,
  hashProperty,
  wrapPathInSvg,
  notifyError,
} from "@holochain-open-dev/elements";
import { consume } from "@lit-labs/context";
import { localized, msg } from "@lit/localize";
import { mdiPencil, mdiDelete } from "@mdi/js";

import "@holochain-open-dev/elements/dist/elements/display-error.js";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/alert/alert.js";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/icon-button/icon-button.js";

import "@lightningrodlabs/attachments/dist/elements/attachments-card.js";
import "@lightningrodlabs/attachments/dist/elements/attachments-bar.js";

import "./edit-post.js";

import { PostsStore } from "../posts-store.js";
import { postsStoreContext } from "../context.js";
import { Post } from "../types.js";

/**
 * @element post-detail
 * @fires post-deleted: detail will contain { postHash }
 */
@localized()
@customElement("post-detail")
export class PostDetail extends LitElement {
  // REQUIRED. The hash of the Post to show
  @property(hashProperty("post-hash"))
  postHash!: ActionHash;

  /**
   * @internal
   */
  @consume({ context: postsStoreContext, subscribe: true })
  postsStore!: PostsStore;

  /**
   * @internal
   */
  _post = new StoreSubscriber(
    this,
    () => this.postsStore.posts.get(this.postHash),
    () => [this.postHash]
  );

  /**
   * @internal
   */
  @state()
  _editing = false;

  async deletePost() {
    try {
      await this.postsStore.client.deletePost(this.postHash);

      this.dispatchEvent(
        new CustomEvent("post-deleted", {
          bubbles: true,
          composed: true,
          detail: {
            postHash: this.postHash,
          },
        })
      );
    } catch (e: any) {
      console.error(e);
      notifyError(msg("Error deleting the post"));
    }
  }

  renderDetail(entryRecord: EntryRecord<Post>) {
    return html`
      <div class="column" style="flex: 1;">
        <sl-card style="flex: 1;">
          <div slot="header" style="display: flex; flex-direction: row;">
            <span style="font-size: 18px; flex: 1;">${msg("Post")}</span>

            <sl-icon-button
              style="margin-left: 8px"
              .src=${wrapPathInSvg(mdiPencil)}
              @click=${() => {
                this._editing = true;
              }}
            ></sl-icon-button>
            <sl-icon-button
              style="margin-left: 8px"
              .src=${wrapPathInSvg(mdiDelete)}
              @click=${() => this.deletePost()}
            ></sl-icon-button>
          </div>


          <div style="display: flex; flex-direction: column">
            <div
              style="display: flex; flex-direction: column; margin-bottom: 16px"
            >
              <span style="margin-bottom: 8px"
                ><strong>${msg("Title")}:</strong></span
              >
              <span style="white-space: pre-line"
                >${entryRecord.entry.title}</span
              >
            </div>

            <div
              style="display: flex; flex-direction: column; margin-bottom: 16px"
            >
              <span style="margin-bottom: 8px"
                ><strong>${msg("Content")}:</strong></span
              >
              <span style="white-space: pre-line"
                >${entryRecord.entry.content}</span
              >
            </div>
          </div>
        </sl-card>
        <attachments-card .hash=${this.postHash}></attachments-card>
      </div>
    `;
  }

  render() {
    switch (this._post.value.status) {
      case "pending":
        return html`<sl-card style="flex: 1;">
          <div
            style="display: flex; flex: 1; align-items: center; justify-content: center"
          >
            <sl-spinner style="font-size: 2rem;"></sl-spinner>
          </div>
        </sl-card>`;
      case "complete":
        const post = this._post.value.value;

        if (!post)
          return html`<span>${msg("The requested post doesn't exist")}</span>`;

        if (this._editing) {
          return html`<edit-post
            .originalPostHash=${this.postHash}
            .currentRecord=${post}
            @post-updated=${async () => {
              this._editing = false;
            }}
            @edit-canceled=${() => {
              this._editing = false;
            }}
            style="display: flex; flex: 1;"
          ></edit-post>`;
        }

        return this.renderDetail(post);
      case "error":
        return html`<sl-card style="flex: 1;">
          <display-error
            .headline=${msg("Error fetching the post")}
            .error=${this._post.value.error.data.data}
          ></display-error>
        </sl-card>`;
    }
  }

  static styles = [sharedStyles];
}

import { LitElement, html } from "lit";
import { state, customElement, property } from "lit/decorators.js";
import { AgentPubKey, EntryHash, ActionHash, Record } from "@holochain/client";
import { StoreSubscriber } from "@holochain-open-dev/stores";
import { consume } from "@lit-labs/context";
import { localized, msg } from "@lit/localize";
import {
  hashProperty,
  sharedStyles,
  wrapPathInSvg,
} from "@holochain-open-dev/elements";
import { mdiInformationOutline } from "@mdi/js";

import "@holochain-open-dev/elements/dist/elements/display-error.js";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";

import "@lightningrodlabs/attachments/dist/elements/add-attachment.js";

import "./post-summary.js";
import { PostsStore } from "../posts-store.js";
import { postsStoreContext } from "../context.js";
import { EntryRecord } from "@holochain-open-dev/utils";
import { Post } from "../types.js";

/**
 * @element all-posts
 */
@localized()
@customElement("all-posts")
export class AllPosts extends LitElement {
  /**
   * @internal
   */
  @consume({ context: postsStoreContext, subscribe: true })
  postsStore!: PostsStore;

  /**
   * @internal
   */
  _allPosts = new StoreSubscriber(
    this,
    () => this.postsStore.allPosts,
    () => []
  );

  renderList(records: Array<EntryRecord<Post>>) {
    if (records.length === 0)
      return html` <div class="column center-content">
        <sl-icon
          .src=${wrapPathInSvg(mdiInformationOutline)}
          style="color: grey; height: 64px; width: 64px; margin-bottom: 16px"
        ></sl-icon>
        <span class="placeholder">${msg("No posts found")}</span>
      </div>`;

    return html`
      <div style="display: flex; flex-direction: row; flex: 1; flex-wrap: wrap;">
        ${records.sort((a, b) => b.action.timestamp - a.action.timestamp).map(
          (record) =>
            html`<post-summary
              @notification=${(e: CustomEvent) => this.dispatchEvent(new CustomEvent('notification', {
                detail: e.detail,
                bubbles: true,
              }))}
              .postHash=${record.actionHash}
              style="margin: 0 16px 16px 0; width: 300px; height: 200px;"
            ></post-summary>`
        )}
      </div>
    `;
  }

  render() {
    switch (this._allPosts.value.status) {
      case "pending":
        return html`<div
          style="display: flex; flex: 1; align-items: center; justify-content: center"
        >
          <sl-spinner style="font-size: 2rem;"></sl-spinner>
        </div>`;
      case "complete":
        return this.renderList(this._allPosts.value.value);
      case "error":
        return html`<display-error
          .headline=${msg("Error fetching the posts")}
          .error=${this._allPosts.value.error}
        ></display-error>`;
    }
  }

  static styles = [sharedStyles];
}

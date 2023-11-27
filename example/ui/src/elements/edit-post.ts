import { LitElement, html } from 'lit';
import { repeat } from "lit/directives/repeat.js";
import { state, customElement, property } from 'lit/decorators.js';
import { ActionHash, Record, EntryHash, AgentPubKey } from '@holochain/client';
import { EntryRecord } from '@holochain-open-dev/utils';
import { hashState, notifyError, sharedStyles, hashProperty, wrapPathInSvg, onSubmit } from '@holochain-open-dev/elements';
import { consume } from '@lit-labs/context';
import { localized, msg } from '@lit/localize';
import { mdiAlertCircleOutline, mdiDelete } from '@mdi/js';

import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import SlAlert from '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import { PostsStore } from '../posts-store';
import { postsStoreContext } from '../context';
import { Post } from '../types';

/**
 * @element edit-post
 * @fires post-updated: detail will contain { originalPostHash, previousPostHash, updatedPostHash }
 */
@localized()
@customElement('edit-post')
export class EditPost extends LitElement {

  // REQUIRED. The hash of the original `Create` action for this Post
  @property(hashProperty('original-post-hash'))
  originalPostHash!: ActionHash;

  // REQUIRED. The current Post record that should be updated
  @property()
  currentRecord!: EntryRecord<Post>;

  /**
   * @internal
   */
  @consume({ context: postsStoreContext })
  postsStore!: PostsStore;

  /**
   * @internal
   */
  @state()
  committing = false;


  firstUpdated() {
    this.shadowRoot?.querySelector('form')!.reset();
  }

  async updatePost(fields: any) {
    const post: Post = {
      title: fields.title,
      content: fields.content,
    };

    try {
      this.committing = true;
      const updateRecord = await this.postsStore.client.updatePost(
        this.originalPostHash,
        this.currentRecord.actionHash,
        post
      );

      this.dispatchEvent(new CustomEvent('post-updated', {
        composed: true,
        bubbles: true,
        detail: {
          originalPostHash: this.originalPostHash,
          previousPostHash: this.currentRecord.actionHash,
          updatedPostHash: updateRecord.actionHash
        }
      }));
    } catch (e: any) {
      console.error(e);
      notifyError(msg("Error updating the post"));
    }

    this.committing = false;
  }

  render() {
    return html`
      <sl-card style="flex: 1;">
        <span slot="header">${msg("Edit Post")}</span>

        <form
          style="display: flex; flex: 1; flex-direction: column;"
          ${onSubmit(fields => this.updatePost(fields))}
        >
          <div style="margin-bottom: 16px">
        <sl-input name="title" .label=${msg("Title")}  required .defaultValue=${ this.currentRecord.entry.title }></sl-input>          </div>

          <div style="margin-bottom: 16px">
        <sl-textarea name="content" .label=${msg("Content")}  required .defaultValue=${ this.currentRecord.entry.content }></sl-textarea>          </div>



          <div style="display: flex; flex-direction: row">
            <sl-button
              @click=${() => this.dispatchEvent(new CustomEvent('edit-canceled', {
                bubbles: true,
                composed: true
              }))}
              style="flex: 1;"
            >${msg("Cancel")}</sl-button>
            <sl-button
              type="submit"
              variant="primary"
              style="flex: 1;"
              .loading=${this.committing}
            >${msg("Save")}</sl-button>

          </div>
        </form>
      </sl-card>`;
  }

  static styles = [sharedStyles];
}

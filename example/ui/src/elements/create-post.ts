import { LitElement, html } from 'lit';
import { state, query, customElement } from 'lit/decorators.js';
import { EntryRecord } from '@holochain-open-dev/utils';
import { notifyError, sharedStyles, onSubmit } from '@holochain-open-dev/elements';
import { consume } from '@lit-labs/context';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import { PostsStore } from '../posts-store.js';
import { postsStoreContext } from '../context.js';
import { Post } from '../types.js';

/**
 * @element create-post
 * @fires post-created: detail will contain { postHash }
 */
@localized()
@customElement('create-post')
export class CreatePost extends LitElement {

  /**
   * @internal
   */
  @consume({ context: postsStoreContext, subscribe: true })
  postsStore!: PostsStore;

  /**
   * @internal
   */
  @state()
  committing = false;

  /**
   * @internal
   */
  @query('#create-form')
  form!: HTMLFormElement;


  async createPost(fields: any) {
    if (this.committing) return;


    const post: Post = {
      title: fields.title,
      content: fields.content,
    };

    try {
      this.committing = true;
      const record: EntryRecord<Post> = await this.postsStore.client.createPost(post);

      this.dispatchEvent(new CustomEvent('post-created', {
        composed: true,
        bubbles: true,
        detail: {
          postHash: record.actionHash
        }
      }));

      this.form.reset();
    } catch (e: any) {
      console.error(e);
      notifyError(msg("Error creating the post"));
    }
    this.committing = false;
  }

  render() {
    return html`
      <sl-card style="flex: 1;">
        <span slot="header">${msg("Create Post")}</span>

        <form
          id="create-form"
          style="display: flex; flex: 1; flex-direction: column;"
          ${onSubmit(fields => this.createPost(fields))}
        >
          <div style="margin-bottom: 16px;">
          <sl-input name="title" .label=${msg("Title")}  required></sl-input>          </div>

          <div style="margin-bottom: 16px;">
          <sl-textarea name="content" .label=${msg("Content")}  required></sl-textarea>          </div>


          <sl-button
            variant="primary"
            type="submit"
            .loading=${this.committing}
          >${msg("Create Post")}</sl-button>
        </form>
      </sl-card>`;
  }

  static styles = [sharedStyles];
}

import { LitElement, css, html } from 'lit';
import { state, property, customElement } from 'lit/decorators.js';
import { ActionHash } from '@holochain/client';
import { EntryRecord } from '@holochain-open-dev/utils';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import {
  sharedStyles,
  hashProperty,
  wrapPathInSvg,
  notifyError,
} from '@holochain-open-dev/elements';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { mdiPencil, mdiDelete, mdiPlus } from '@mdi/js';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/popup/popup.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';

import '@theweave/elements/dist/elements/select-asset-menu.js';

import './edit-post.js';
import './asset-element.js';
import './micro-menu.js';

import { PostsStore } from '../posts-store.js';
import { postsStoreContext } from '../context.js';
import { Post } from '../types.js';
import {
  AssetStore,
  AssetStoreContent,
  AsyncStatus,
  stringifyWal,
  WAL,
  WeaveClient,
  weaveUrlFromWal,
} from '@theweave/api';
import { repeat } from 'lit/directives/repeat.js';

/**
 * @element post-detail
 * @fires post-deleted: detail will contain { postHash }
 */
@localized()
@customElement('post-detail')
export class PostDetail extends LitElement {
  // REQUIRED. The hash of the Post to show
  @property(hashProperty('post-hash'))
  postHash!: ActionHash;

  @property()
  weaveClient!: WeaveClient;

  /**
   * @internal
   */
  @consume({ context: postsStoreContext, subscribe: true })
  postsStore!: PostsStore;

  @state()
  assetStore: AssetStore | undefined;

  @state()
  assetStoreContent: AsyncStatus<AssetStoreContent> | undefined;

  /**
   * @internal
   */
  _post = new StoreSubscriber(
    this,
    () => this.postsStore.posts.get(this.postHash),
    () => [this.postHash]
  );

  @state()
  WAL: WAL | undefined;

  /**
   * @internal
   */
  @state()
  _editing = false;

  async firstUpdated() {
    const dnaHash = await this.postsStore.client.getDnaHash();
    this.WAL = {
      hrl: [dnaHash, this.postHash],
    };
    this.weaveClient.assets.assetStore(this.WAL).subscribe((val) => {
      console.log('Got new value: ', val);
      this.assetStoreContent = val;
      this.requestUpdate();
    });
    this.weaveClient.onPeerStatusUpdate((update) => {
      console.log('@post-detail: Got peer-status-update: ', update);
    });
  }

  async deletePost() {
    try {
      await this.postsStore.client.deletePost(this.postHash);

      this.dispatchEvent(
        new CustomEvent('post-deleted', {
          bubbles: true,
          composed: true,
          detail: {
            postHash: this.postHash,
          },
        })
      );
    } catch (e: any) {
      console.error(e);
      notifyError(msg('Error deleting the post'));
    }
  }

  renderAssets() {
    if (!this.assetStoreContent || this.assetStoreContent.status === 'pending')
      return html`loading...`;
    if (this.assetStoreContent.status === 'error') {
      console.log(this.assetStoreContent.error);
      return html`ERROR`;
    }
    console.log('Rendering assets: ', this.assetStoreContent);
    return html` <div class="column">
      ${repeat(
        this.assetStoreContent.value.linkedFrom,
        (walAndTags) => stringifyWal(walAndTags.wal),
        (walAndTags) =>
          html`<asset-element
            @wal-selected=${(e: CustomEvent) => this.weaveClient.openAsset(e.detail.wal)}
            style="margin: 2px;"
            .walRelationAndTags=${walAndTags}
            @remove-wal=${() => {
              this.weaveClient.assets.removeAssetRelation(walAndTags.relationHash);
            }}
          ></asset-element>`
      )}
    </div>`;
  }

  renderDetail(entryRecord: EntryRecord<Post>) {
    return html`
      <div class="column" style="flex: 1;">
        <div class="row">
          <micro-menu
            .weaveClient=${this.weaveClient}
            @wal-selected=${(e: any) => {
              console.log('WAL selected: ', e.detail);
            }}
            title="attach asset long title long"
            distance="10"
            skidding="5"
            flip
          >
            <sl-icon style="font-size: 25px;" .src=${wrapPathInSvg(mdiPlus)}></sl-icon>
          </micro-menu>
        </div>
        <sl-card style="flex: 1;">
          <div slot="header" style="display: flex; flex-direction: row;">
            <span style="font-size: 18px; flex: 1;">${msg('Post')}</span>

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
            <div style="display: flex; flex-direction: column; margin-bottom: 16px">
              <span style="margin-bottom: 8px"><strong>${msg('Title')}:</strong></span>
              <span style="white-space: pre-line">${entryRecord.entry.title}</span>
            </div>

            <div style="display: flex; flex-direction: column; margin-bottom: 16px">
              <span style="margin-bottom: 8px"><strong>${msg('Content')}:</strong></span>
              <span style="white-space: pre-line">${entryRecord.entry.content}</span>
            </div>
          </div>
        </sl-card>
        <div class="column">
          <div class="row">
            <select-asset-menu
              .weaveClient=${this.weaveClient}
              @wal-selected=${(e: any) => {
                console.log('WAL selected: ', e.detail);
              }}
              title="attach asset"
              distance="10"
              skidding="5"
            >
              <sl-icon style="font-size: 25px;" .src=${wrapPathInSvg(mdiPlus)}></sl-icon>
            </select-asset-menu>
          </div>
          <button
            @click=${async () => {
              const wal = await this.weaveClient.assets.userSelectAsset();
              if (wal && this.WAL) {
                await this.weaveClient.assets.addAssetRelation(this.WAL, wal);
              }
            }}
          >
            Select Asset to attach
          </button>
          <div class="column">${this.renderAssets()}</div>
        </div>
      </div>
      <sl-button
        style="margin-top: 20px;"
        variant="danger"
        @click=${() => this.weaveClient.requestClose()}
        >Close Window (only works if open in separate Window)</sl-button
      >
    `;
  }

  render() {
    switch (this._post.value.status) {
      case 'pending':
        return html`<sl-card style="flex: 1;">
          <div style="display: flex; flex: 1; align-items: center; justify-content: center">
            <sl-spinner style="font-size: 2rem;"></sl-spinner>
          </div>
        </sl-card>`;
      case 'complete':
        const post = this._post.value.value;

        if (!post) return html`<span>${msg("The requested post doesn't exist")}</span>`;

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
      case 'error':
        return html`<sl-card style="flex: 1;">
          <display-error
            .headline=${msg('Error fetching the post')}
            .error=${this._post.value.error.data.data}
          ></display-error>
        </sl-card>`;
    }
  }

  static styles = [
    sharedStyles,
    css`
      sl-popup::part(popup) {
      }
    `,
  ];
}

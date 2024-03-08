import { LitElement, css, html } from 'lit';
import { property } from 'lit/decorators.js';

import { localized } from '@lit/localize';
import { sharedStyles } from '@holochain-open-dev/elements';

import './elements/all-posts.js';
import './elements/create-post.js';
import './elements/post-detail.js';
import './elements/posts-context.js';

import { WeClient, FrameNotification } from '@lightningrodlabs/we-applet';
import { weClientContext } from '@lightningrodlabs/we-elements';

import '@lightningrodlabs/we-elements/dist/elements/we-client-context.js';
import '@lightningrodlabs/attachments/dist/elements/attachments-context.js';

import './applet-main.js';
import './cross-applet-main.js';
import { AttachmentsStore } from '@lightningrodlabs/attachments';
import { ActionHash, CellType, DnaHash } from '@holochain/client';
import { consume } from '@lit/context';
import { PostsStore } from './posts-store.js';
import { PostsClient } from './posts-client.js';

@localized()
// @customElement("example-applet")
export class ExampleApplet extends LitElement {
  @consume({ context: weClientContext as { __context__: WeClient } })
  weClient!: WeClient;

  @property()
  postsStore!: PostsStore;

  @property()
  attachmentsStore!: AttachmentsStore;

  firstUpdated() {
    // if (this.weClient.renderInfo.type === 'applet-view') {
    //   const groupProfiles = this.weClient.renderInfo.groupProfiles;
    //   const appletHash = this.weClient.renderInfo.appletHash;
    //   console.log('we link for applet: ', weaveUrlFromAppletHash(appletHash));
    // }
  }

  async notifyWe(notifications: FrameNotification[]) {
    this.weClient.notifyFrame(notifications);
  }

  render() {
    if (!this.weClient.renderInfo) return html`loading...`;
    switch (this.weClient.renderInfo.type) {
      case 'applet-view':
        switch (this.weClient.renderInfo.view.type) {
          case 'main':
            const client = this.weClient.renderInfo.appletClient;
            return html`
              <posts-context .store=${this.postsStore}>
                <attachments-context .store=${this.attachmentsStore}>
                  <applet-main
                    .client=${this.weClient.renderInfo.appletClient}
                    .weClient=${this.weClient}
                    @notification=${(e: CustomEvent) => this.notifyWe(e.detail)}
                    @post-selected=${async (e: CustomEvent) => {
                      const appInfo = await client.appInfo();
                      const dnaHash = (appInfo.cell_info.forum[0] as any)[CellType.Provisioned]
                        .cell_id[0];
                      this.weClient!.openWal({ hrl: [dnaHash, e.detail.postHash] }, 'front');
                    }}
                  ></applet-main>
                </attachments-context>
              </posts-context>
            `;
          case 'block':
            throw new Error('Block view is not implemented.');
          case 'asset':
            switch (this.weClient.renderInfo.view.roleName) {
              case 'forum':
                switch (this.weClient.renderInfo.view.integrityZomeName) {
                  case 'posts_integrity':
                    switch (this.weClient.renderInfo.view.entryType) {
                      case 'post':
                        return html`
                          <posts-context .store=${this.postsStore}>
                            <attachments-context .store=${this.attachmentsStore}>
                              <post-detail
                                .postHash=${this.weClient.renderInfo.view.wal.hrl[1]}
                              ></post-detail>
                            </attachments-context>
                          </posts-context>
                        `;
                      default:
                        throw new Error(
                          `Unknown entry type ${this.weClient.renderInfo.view.entryType}.`
                        );
                    }
                  default:
                    throw new Error(
                      `Unknown zome '${this.weClient.renderInfo.view.integrityZomeName}'.`
                    );
                }
              default:
                throw new Error(`Unknown role name '${this.weClient.renderInfo.view.roleName}'.`);
            }
          case 'creatable':
            switch (this.weClient.renderInfo.view.name) {
              case 'post':
                const reject = this.weClient.renderInfo.view.reject;
                const resolve = this.weClient.renderInfo.view.resolve;
                const cancel = this.weClient.renderInfo.view.cancel;
                const appletClient = this.weClient.renderInfo.appletClient;
                const postsClient = new PostsClient(appletClient, 'forum');
                return html`
                  <div class="column" style="align-items: center; flex: 1;">
                    <div>Choose title:</div>
                    <input id="title-input" type="text" />
                    <div class="row">
                      <button @click=${async () => cancel()}>Cancel</button>
                      <button
                        @click=${async () => {
                          const title = (
                            this.shadowRoot!.getElementById('title-input') as HTMLInputElement
                          ).value;
                          const post = {
                            title,
                            content: '',
                          };
                          try {
                            const postRecord = await postsClient.createPost(post);
                            const appInfo = await appletClient.appInfo();
                            const dnaHash = (appInfo.cell_info.forum[0] as any)[
                              CellType.Provisioned
                            ].cell_id[0];
                            const hrl: [DnaHash, ActionHash] = [dnaHash, postRecord.actionHash];
                            await resolve({
                              hrl,
                            });
                          } catch (e) {
                            await reject(e);
                          }
                        }}
                      >
                        Create
                      </button>
                    </div>
                  </div>
                `;
              default:
                throw new Error(`Unknown creatable type '${this.weClient.renderInfo.view.name}'.`);
            }
          default:
            throw new Error(`Unknown applet-view type.`);
        }
      case 'cross-applet-view':
        return html`
          <cross-applet-main .applets=${this.weClient.renderInfo.applets}></cross-applet-main>
        `;
      default:
        throw new Error('Unknown render view type');
    }
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex: 1;
      }
    `,
    sharedStyles,
  ];
}

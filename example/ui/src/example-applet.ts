import { LitElement, css, html } from 'lit';
import { property } from 'lit/decorators.js';

import { localized } from '@lit/localize';
import { sharedStyles } from '@holochain-open-dev/elements';

import './elements/all-posts.js';
import './elements/create-post.js';
import './elements/post-detail.js';
import './elements/posts-context.js';

import { WeaveClient, FrameNotification } from '@lightningrodlabs/we-applet';
import { weaveClientContext } from '@lightningrodlabs/we-elements';

import '@lightningrodlabs/we-elements/dist/elements/weave-client-context.js';
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
  @consume({ context: weaveClientContext as { __context__: WeaveClient } })
  weaveClient!: WeaveClient;

  @property()
  postsStore!: PostsStore;

  @property()
  attachmentsStore!: AttachmentsStore;

  @property()
  interval: any;

  firstUpdated() {
    // To test whether applet iframe properly gets removed after disabling applet.
    setInterval(() => {
      console.log('Hello from the example applet iframe.');
    }, 3000);
    // if (this.weaveClient.renderInfo.type === 'applet-view') {
    //   const groupProfiles = this.weaveClient.renderInfo.groupProfiles;
    //   const appletHash = this.weaveClient.renderInfo.appletHash;
    //   console.log('we link for applet: ', weaveUrlFromAppletHash(appletHash));
    // }
  }

  async notifyWe(notifications: FrameNotification[]) {
    this.weaveClient.notifyFrame(notifications);
  }

  render() {
    if (!this.weaveClient.renderInfo) return html`loading...`;
    switch (this.weaveClient.renderInfo.type) {
      case 'applet-view':
        switch (this.weaveClient.renderInfo.view.type) {
          case 'main':
            const client = this.weaveClient.renderInfo.appletClient;
            return html`
              <posts-context .store=${this.postsStore}>
                <attachments-context .store=${this.attachmentsStore}>
                  <applet-main
                    .client=${this.weaveClient.renderInfo.appletClient}
                    .weaveClient=${this.weaveClient}
                    @notification=${(e: CustomEvent) => this.notifyWe(e.detail)}
                    @post-selected=${async (e: CustomEvent) => {
                      const appInfo = await client.appInfo();
                      if (!appInfo) throw new Error('AppInfo is null.');
                      const dnaHash = (appInfo.cell_info.forum[0] as any)[CellType.Provisioned]
                        .cell_id[0];
                      this.weaveClient!.openWal({ hrl: [dnaHash, e.detail.postHash] }, 'front');
                    }}
                  ></applet-main>
                </attachments-context>
              </posts-context>
            `;
          case 'block':
            throw new Error('Block view is not implemented.');
          case 'asset':
            if (!this.weaveClient.renderInfo.view.recordLocation) {
              throw new Error(
                'The example applet does not implement asset views pointing to DNAs instead of Records.'
              );
            } else {
              switch (this.weaveClient.renderInfo.view.recordLocation.roleName) {
                case 'forum':
                  switch (this.weaveClient.renderInfo.view.recordLocation.integrityZomeName) {
                    case 'posts_integrity':
                      switch (this.weaveClient.renderInfo.view.recordLocation.entryType) {
                        case 'post':
                          return html`
                            <posts-context .store=${this.postsStore}>
                              <attachments-context .store=${this.attachmentsStore}>
                                <post-detail
                                  .postHash=${this.weaveClient.renderInfo.view.wal.hrl[1]}
                                ></post-detail>
                              </attachments-context>
                            </posts-context>
                          `;
                        default:
                          throw new Error(
                            `Unknown entry type ${this.weaveClient.renderInfo.view.recordLocation.entryType}.`
                          );
                      }
                    default:
                      throw new Error(
                        `Unknown zome '${this.weaveClient.renderInfo.view.recordLocation.integrityZomeName}'.`
                      );
                  }
                default:
                  throw new Error(
                    `Unknown role name '${this.weaveClient.renderInfo.view.recordLocation.roleName}'.`
                  );
              }
            }
          case 'creatable':
            switch (this.weaveClient.renderInfo.view.name) {
              case 'post':
                const reject = this.weaveClient.renderInfo.view.reject;
                const resolve = this.weaveClient.renderInfo.view.resolve;
                const cancel = this.weaveClient.renderInfo.view.cancel;
                const appletClient = this.weaveClient.renderInfo.appletClient;
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
                            if (!appInfo) throw new Error('AppInfo is null.');
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
                    <div style="margin-top: 200px; width: 600px; background: blue;">
                      Here is more content to make the dialog require more space.
                    </div>
                  </div>
                `;
              default:
                throw new Error(
                  `Unknown creatable type '${this.weaveClient.renderInfo.view.name}'.`
                );
            }
          default:
            throw new Error(`Unknown applet-view type.`);
        }
      case 'cross-applet-view':
        return html`
          <cross-applet-main .applets=${this.weaveClient.renderInfo.applets}></cross-applet-main>
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

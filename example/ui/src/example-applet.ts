import { LitElement, css, html } from 'lit';
import { property } from 'lit/decorators.js';

import { localized } from '@lit/localize';
import { sharedStyles } from '@holochain-open-dev/elements';

import './elements/all-posts.js';
import './elements/create-post.js';
import './elements/post-detail.js';
import './elements/posts-context.js';

import { WeaveClient, FrameNotification, UnsubscribeFunction, LifecycleState } from '@theweave/api';
import { weaveClientContext } from '@theweave/elements';

import '@theweave/elements/dist/elements/weave-client-context.js';

import './applet-main.js';
import './cross-group-main.js';
import { ActionHash, CellType, DnaHash, ProvisionedCell } from '@holochain/client';
import { consume } from '@lit/context';
import { PostsStore } from './posts-store.js';
import { PostsClient } from './posts-client.js';
import { ProfilesStore } from '@holochain-open-dev/profiles';
import '@holochain-open-dev/profiles/dist/elements/profiles-context.js';

@localized()
// @customElement("example-applet")
export class ExampleApplet extends LitElement {
  @consume({ context: weaveClientContext as { __context__: WeaveClient } })
  weaveClient!: WeaveClient;

  @property()
  postsStore!: PostsStore;

  @property()
  interval: any;

  peerStatusUnsubscribe: UnsubscribeFunction | undefined;

  onBeforeUnloadUnsubscribe: UnsubscribeFunction | undefined;

  lifecycleUnsubscribe: UnsubscribeFunction | undefined;

  firstUpdated() {
    this.onBeforeUnloadUnsubscribe = this.weaveClient.onBeforeUnload(async () => {
      // Uncomment below to test that unloading after force reload timeout works
      // console.log('Unloading in 10 seconds');
      // await new Promise((resolve) => setTimeout(resolve, 10000));
      console.log('Unloading now.');
    });

    // Subscribe to lifecycle changes
    this.lifecycleUnsubscribe = this.weaveClient.onLifecycleChange((state: LifecycleState) => {
      console.log(`[Example Applet] Lifecycle state changed to: ${state}`);

      // Tools can adjust their behavior based on lifecycle state
      // For example, pause/resume timers, cleanup DOM, etc.
      switch (state) {
        case 'active':
          // Applet is active - resume full functionality
          console.log('[Example Applet] Resuming full functionality');
          break;
        case 'inactive':
          // Applet is inactive but recently used - continue background processing
          console.log('[Example Applet] Continuing background processing');
          break;
        case 'suspended':
          // Applet is suspended - DOM removed but data kept
          console.log('[Example Applet] Suspended - DOM removed, data preserved');
          break;
        case 'discarded':
          // Applet is discarded - iframe will be recreated on activation
          console.log('[Example Applet] Discarded - will be recreated on activation');
          break;
      }
    });

    // To test whether applet iframe properly gets removed after disabling applet.
    // setInterval(() => {
    //   console.log('Hello from the example applet iframe.');
    // }, 3000);
    // if (this.weaveClient.renderInfo.type === 'applet-view') {
    //   const groupProfiles = this.weaveClient.renderInfo.groupProfiles;
    //   const appletHash = this.weaveClient.renderInfo.appletHash;
    //   console.log('we link for applet: ', weaveUrlFromAppletHash(appletHash));
    // }
    // this.peerStatusUnsubscribe = this.weaveClient.onPeerStatusUpdate((payload) => {
    //   console.log('Got peer status update: ', payload);
    // });
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
            const profilesStore = new ProfilesStore(this.weaveClient.renderInfo.profilesClient);
            return html`
              <posts-context .store=${this.postsStore}>
                <profiles-context .store=${profilesStore}>
                  <applet-main
                    .client=${this.weaveClient.renderInfo.appletClient}
                    .weaveClient=${this.weaveClient}
                    .peerStatusStore=${this.weaveClient.renderInfo.peerStatusStore}
                    @notification=${(e: CustomEvent) => this.notifyWe(e.detail)}
                    @post-selected=${async (e: CustomEvent) => {
                const appInfo = await client.appInfo();
                if (!appInfo) throw new Error('AppInfo is null.');
                const dnaHash = (appInfo.cell_info.forum[0].value as ProvisionedCell)
                  .cell_id[0];
                this.weaveClient!.openAsset({ hrl: [dnaHash, e.detail.postHash] }, 'side');
              }}
                    @drag-post=${async (e: CustomEvent) => {
                console.log('GOT DRAG POST EVENT!');
                const appInfo = await client.appInfo();
                if (!appInfo) throw new Error('AppInfo is null.');
                const dnaHash = (appInfo.cell_info.forum[0].value as ProvisionedCell)
                  .cell_id[0];
                this.weaveClient!.assets.dragAsset({
                  hrl: [dnaHash, e.detail],
                });
              }}
                  ></applet-main>
                </profiles-context>
              </posts-context>
            `;
          case 'block':
            throw new Error('Block view is not implemented.');
          case 'asset':
            if (!this.weaveClient.renderInfo.view.recordInfo) {
              throw new Error(
                'The example applet does not implement asset views pointing to DNAs instead of Records.'
              );
            } else {
              switch (this.weaveClient.renderInfo.view.recordInfo.roleName) {
                case 'forum':
                  switch (this.weaveClient.renderInfo.view.recordInfo.integrityZomeName) {
                    case 'posts_integrity':
                      switch (this.weaveClient.renderInfo.view.recordInfo.entryType) {
                        case 'post':
                          return html`
                            <posts-context .store=${this.postsStore}>
                              <post-detail
                                .postHash=${this.weaveClient.renderInfo.view.wal.hrl[1]}
                                .weaveClient=${this.weaveClient}
                              ></post-detail>
                            </posts-context>
                          `;
                        default:
                          throw new Error(
                            `Unknown entry type ${this.weaveClient.renderInfo.view.recordInfo.entryType}.`
                          );
                      }
                    default:
                      throw new Error(
                        `Unknown zome '${this.weaveClient.renderInfo.view.recordInfo.integrityZomeName}'.`
                      );
                  }
                default:
                  throw new Error(
                    `Unknown role name '${this.weaveClient.renderInfo.view.recordInfo.roleName}'.`
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
                      const dnaHash = (appInfo.cell_info.forum[0].value as ProvisionedCell)
                        .cell_id[0];
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
      case 'cross-group-view':
        return html`
          <cross-group-main .applets=${this.weaveClient.renderInfo.applets}></cross-group-main>
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

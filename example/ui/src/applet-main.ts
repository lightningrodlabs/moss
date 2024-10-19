import { LitElement, css, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';

import { localized } from '@lit/localize';
import { sharedStyles } from '@holochain-open-dev/elements';

import './elements/all-posts.js';
import './elements/create-post.js';
import {
  type WAL,
  type FrameNotification,
  WeaveClient,
  weaveUrlToLocation,
  ReadonlyPeerStatusStore,
  GroupPermissionType,
  UnsubscribeFunction,
} from '@theweave/api';
import { AgentPubKey, AppClient } from '@holochain/client';
import '@theweave/elements/dist/elements/wal-embed.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { ProfilesStore, profilesStoreContext } from '@holochain-open-dev/profiles';
import { consume, provide } from '@lit/context';
import './elements/agent-status.js';
import '@holochain-open-dev/profiles/dist/elements/search-agent.js';
import { weaveClientContext } from '@theweave/elements';

@localized()
@customElement('applet-main')
export class AppletMain extends LitElement {
  @property()
  client!: AppClient;

  @provide({ context: weaveClientContext })
  @property()
  weaveClient!: WeaveClient;

  @property()
  peerStatusStore!: ReadonlyPeerStatusStore;

  @consume({ context: profilesStoreContext, subscribe: true })
  @property()
  profilesStore!: ProfilesStore;

  @query('#wal-input-field')
  walInputField!: HTMLInputElement;

  @query('#wal-embed-input-field')
  walEmbedInputField!: HTMLInputElement;

  @query('#wal-embed-bare-field')
  walEmbedBareField!: HTMLInputElement;

  @state()
  mediumInterval: number | null = null;

  @state()
  highInterval: number | null = null;

  @state()
  selectedWal: WAL | undefined = undefined;

  @state()
  walLink: string = '';

  @state()
  walEmbedLink: string = '';

  @state()
  bare: boolean = true;

  @state()
  groupPermissionType: GroupPermissionType | undefined;

  @state()
  appletParticipants: AgentPubKey[] | undefined;

  @state()
  selectedAgent: AgentPubKey | undefined;
  // @state()
  // unsubscribe: undefined | (() => void);

  @query('#failUnbeforeUnloadCheckmark')
  failUnbeforeUnloadCheckmark!: HTMLInputElement;

  onBeforeUnloadUnsubscribe: UnsubscribeFunction | undefined;

  async firstUpdated() {
    this.onBeforeUnloadUnsubscribe = this.weaveClient.onBeforeUnload(() => {
      if (this.failUnbeforeUnloadCheckmark.checked)
        throw new Error(
          'The onbeforeunload callback failed (intentionally for testing purposes) in the example applet :(.'
        );
      console.log('@example-applet: Running second unbeforeunload callback.');
    });

    this.groupPermissionType = await this.weaveClient.myGroupPermissionType();
    this.appletParticipants = await this.weaveClient.appletParticipants();
  }

  disconnectedCallback(): void {
    if (this.onBeforeUnloadUnsubscribe) this.onBeforeUnloadUnsubscribe();
  }

  // disconnectedCallback(): void {
  //   if (this.unsubscribe) this.unsubscribe();
  // }

  _allProfiles = new StoreSubscriber(
    this,
    () => this.profilesStore.allProfiles,
    () => [this.profilesStore]
  );

  updateWalLink() {
    this.walLink = this.walInputField.value;
  }

  updateWalEmbedLink() {
    this.walEmbedLink = this.walEmbedInputField.value;
  }

  updateWalEmbedBare() {
    this.bare = this.walEmbedBareField.checked;
  }

  sendUrgentNotification(delay: number) {
    const notification: FrameNotification = {
      title: 'Title',
      body: 'Message body',
      notification_type: 'default',
      icon_src: 'https://static-00.iconduck.com/assets.00/duckduckgo-icon-512x512-zp12dd1l.png',
      urgency: 'high',
      timestamp: Date.now(),
    };
    setTimeout(() => {
      this.dispatchEvent(
        new CustomEvent('notification', {
          detail: [notification],
          bubbles: true,
        })
      );
    }, delay);
  }

  sendMediumNotification(delay: number) {
    setTimeout(() => {
      const notification: FrameNotification = {
        title: 'Title',
        body: 'Message body',
        notification_type: 'default',
        icon_src: 'https://static-00.iconduck.com/assets.00/duckduckgo-icon-512x512-zp12dd1l.png',
        urgency: 'medium',
        timestamp: Date.now(),
      };
      this.dispatchEvent(
        new CustomEvent('notification', {
          detail: [notification],
          bubbles: true,
        })
      );
    }, delay);
  }

  sendLowNotification(delay: number) {
    const notification: FrameNotification = {
      title: 'Title',
      body: 'Message body',
      notification_type: 'default',
      icon_src: 'https://static-00.iconduck.com/assets.00/duckduckgo-icon-512x512-zp12dd1l.png',
      urgency: 'low',
      timestamp: Date.now(),
    };
    setTimeout(() => {
      this.dispatchEvent(
        new CustomEvent('notification', {
          detail: [notification],
          bubbles: true,
        })
      );
    }, delay);
  }

  handleAgentSelected(e: any) {
    console.log('Agent selected', e.detail);
    this.selectedAgent = e.detail.agentPubKey;
  }

  async sendActivityNotification(delay: number, agent: AgentPubKey | undefined) {
    const selectedWal = await this.weaveClient.userSelectWal();
    const notification: FrameNotification = {
      title: 'Activity Notification Title',
      body: 'Message body',
      notification_type: 'default',
      icon_src: 'https://static-00.iconduck.com/assets.00/duckduckgo-icon-512x512-zp12dd1l.png',
      urgency: 'low',
      timestamp: Date.now(),
      aboutWal: selectedWal,
      fromAgent: agent,
    };
    console.log('Sending activity notification', notification);
    setTimeout(() => {
      this.dispatchEvent(
        new CustomEvent('notification', {
          detail: [notification],
          bubbles: true,
        })
      );
    }, delay);
  }

  async userSelectWal() {
    const selectedWal = await this.weaveClient.userSelectWal();
    this.selectedWal = selectedWal;
  }

  renderGroupPeers() {
    switch (this._allProfiles.value.status) {
      case 'pending':
        return html`Loading peer profiles...`;
      case 'error':
        console.error('Failed to get peer profiles: ', this._allProfiles.value.error);
        return html`Failed to get peer profiles. See console for details.`;
      case 'complete':
        return html`
          ${Array.from(this._allProfiles.value.value.keys()).map(
            (agent) =>
              html`
                <agent-status
                  .agent=${agent}
                  .peerStatusStore=${this.peerStatusStore}
                  style="margin-right: 3px;"
                ></agent-status>
              `
          )}
        `;
    }
  }

  renderAppletParticipants() {
    if (!this.appletParticipants) return html`Loading group participants...`;
    return html`
      ${Array.from(this.appletParticipants).map(
        (agent) =>
          html`
            <agent-status
              .agent=${agent}
              .peerStatusStore=${this.peerStatusStore}
              style="margin-right: 3px;"
            ></agent-status>
          `
      )}
    `;
  }

  render() {
    return html`
      <div class="column" style="margin-bottom: 500px;">
        <div class="row" style="justify-content: flex-start; align-items: center;">
          <span>All group agents:</span>${this.renderGroupPeers()}
        </div>
        <div class="row" style="justify-content: flex-start; align-items: center;">
          <span>All Tool participants:</span>${this.renderAppletParticipants()}
        </div>
        <div><b>My Group Permission Type: </b>${JSON.stringify(this.groupPermissionType)}</div>
        <div class="row">
          <div class="column">
            <create-post style="margin: 16px;"></create-post>
            <h2>Notifications</h2>
            <button @click=${() => this.sendLowNotification(5000)}>
              Send Low Urgency Notification with 5 seconds delay
            </button>
            <button @click=${() => this.sendMediumNotification(5000)}>
              Send Medium Urgency Notification with 5 seconds delay
            </button>
            <button @click=${() => this.sendUrgentNotification(5000)}>
              Send High Urgency Notification with 5 seconds delay
            </button>

            <h2>on-before-unload behavior</h2>

            <div class="row">
            <input type="checkbox" id="failUnbeforeUnloadCheckmark"/>
            Make the on-before-unload callback fail when reloading the applet to test how Moss handles this case.
            </div>


            <h2>Activity Notification</h2>

            <search-agent
                @agent-selected=${this.handleAgentSelected}
            ></search-agent>
            <button @click=${() => {
              console.log(this.selectedAgent);
              this.sendActivityNotification(0, this.selectedAgent);
            }}>
              Send Activity Notification
            </button>

            <h2>Links</h2>

            <div>Enter WAL:</div>
            <textarea
              id="wal-input-field"
              type="text"
              @input=${() => this.updateWalLink()}
              rows="4"
              cols="50"
            ></textarea>
            <button>Update WAL Link</button>
            <a href="${this.walLink}"
              >${this.walLink ? this.walLink : 'Paste WAL in field above to update me'}</a
            >
            <a href="${this.walLink}" target="_blank"
              >${this.walLink ? this.walLink : 'Paste WAL in field above to update me'}</a
            >
            <a href="https://duckduckgo.com">duckduckgo.com</a>
            <a href="https://duckduckgo.com" traget="_blank">duckduckgo.com</a>

            <h2>Clipboard</h2>

            <button
              @click=${() => {
                navigator.clipboard.writeText('Easter Egg.');
              }}
            >
              Copy Something To Clipboard
            </button>

            <h2>Bindings</h2>

            <div style="border: 1px solid black; padding: 5px; border-radius: 5px; margin: 10px 0;">
              <div><b>Create Binding:</b></div>
              <div class="row">
                <span>srcWal: </span>
                <input id="src-wal-input" />
              </div>
              <div class="row">
                <span>dstWal: </span>
                <input id="dst-wal-input" />
              </div>
              <button
                @click=${async () => {
                  const srcValInput = this.shadowRoot!.getElementById(
                    'src-wal-input'
                  ) as HTMLInputElement;
                  const dstWalInput = this.shadowRoot!.getElementById(
                    'dst-wal-input'
                  ) as HTMLInputElement;
                  const srcWal = weaveUrlToLocation(srcValInput.value);
                  if (srcWal.type !== 'asset') throw new Error('Invalid srcVal.');
                  const dstWal = weaveUrlToLocation(dstWalInput.value);
                  if (dstWal.type !== 'asset') throw new Error('Invalid dstVal.');
                  await this.weaveClient.requestBind(srcWal.wal, dstWal.wal);
                }}
              >
                Bind!
              </button>
            </div>

            <h2>WAL Embeds</h2>

            <div style="border: 1px solid black; padding: 5px; border-radius: 5px; margin: 10px 0;">
              <div><b>Embed WAL:</b></div>
              <div class="row" style="margin-bottom: 10px;">
                <input id="wal-embed-input-field" type="text" rows="4" cols="50" />
                <button
                  @click=${() => {
                    this.updateWalEmbedBare();
                    this.updateWalEmbedLink();
                  }}
                  style="width: 100px; margin-left: 5px;"
                >
                  Embed
                </button>
              </div>
              <input id="wal-embed-bare-field" type="checkbox">bare embed</input>
              ${
                this.walEmbedLink !== ''
                  ? html`
                      <wal-embed
                        style="margin-top: 20px;"
                        .src=${this.walEmbedLink}
                        ?bare=${this.bare}
                        closable
                        @open-in-sidebar=${() => console.log('Opening in sidebar')}
                        @close=${() => console.log('Closing requested')}
                      ></wal-embed>
                    `
                  : html``
              }
            </div>
          </div>
          <div class="row" style="flex-wrap: wrap;">
            <all-posts
              style="margin: 16px;"
              @notification=${(e: CustomEvent) => {
                this.dispatchEvent(
                  new CustomEvent('notification', {
                    detail: e.detail,
                    bubbles: true,
                  })
                );
              }}
            ></all-posts>
          </div>
        </div>
      </div>
    `;
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

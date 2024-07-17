import { css, html, LitElement } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { sharedStyles, wrapPathInSvg } from '@holochain-open-dev/elements';
import { consume } from '@lit/context';
import '@holochain-open-dev/profiles/dist/elements/profiles-context.js';
import '@holochain-open-dev/profiles/dist/elements/my-profile.js';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import SlInput from '@shoelace-style/shoelace/dist/components/input/input.js';
import '@holochain-open-dev/profiles/dist/elements/profile-detail.js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { Message, Payload, Stream } from '../stream.js';
import { HoloHashMap } from '@holochain-open-dev/utils';
import { get, StoreSubscriber } from '@holochain-open-dev/stores';
import { AgentPubKey, decodeHashFromBase64, encodeHashToBase64 } from '@holochain/client';
import { mdiChat, mdiSofa } from '@mdi/js';

@localized()
@customElement('foyer-stream')
export class FoyerStream extends LitElement {
  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  _peersStatus = new StoreSubscriber(
    this,
    () => this.groupStore.peerStatuses(),
    () => [this.groupStore],
  );

  @state()
  stream: Stream | undefined;

  @query('#msg-input')
  private _msgInput!: SlInput;

  @query('#stream')
  private _conversationContainer!: HTMLElement;

  async firstUpdated() {
    this.stream = get(this.groupStore.foyerStore.streams)['_all'];
    this._messages = new StoreSubscriber(
      this,
      () => this.stream!.messages,
      () => [this.stream],
    );
    this._acks = new StoreSubscriber(
      this,
      () => this.stream!.acks(),
      () => [this.stream],
    );
  }

  @state()
  _messages: StoreSubscriber<Message[]> | undefined;

  @state()
  _acks: StoreSubscriber<Record<number, HoloHashMap<Uint8Array, boolean>>> | undefined;

  @state()
  newMessages: number = 0;

  @state()
  previousMessageCount: number = 0;

  @state()
  disabled = true;

  getRecipients(): AgentPubKey[] {
    const agents: AgentPubKey[] = [];
    const peers = this._peersStatus.value;
    if (!peers) return [];
    else {
      for (const key in peers) {
        const status = peers[key];
        if (key != this.groupStore.foyerStore.myPubKeyB64 && status.status == 'online')
          agents.push(decodeHashFromBase64(key));
      }
    }
    return agents;
  }

  convertMessageText = (text: string): string => {
    let formatted = text.replace(
      /(https?:\/\/[^\s]+)/g,
      '<a style="text-decoration: underline;" href="$1">$1</a>',
    );
    formatted = formatted.replace(
      /(we:\/\/[^\s]+)/g,
      '<a style="text-decoration: underline;" href="$1">$1</a>',
    );
    return formatted;
  };

  sendMessage = async () => {
    const payload: Payload = {
      type: 'Msg',
      text: this._msgInput.value,
      created: Date.now(),
    };
    const hashes = this.getRecipients();
    console.log('SENDING TO', hashes, this.groupStore.foyerStore);
    await this.groupStore.foyerStore.sendMessage('_all', payload, hashes);
    this._msgInput.value = '';
  };

  getAckCount = (acks: { [key: number]: HoloHashMap<Uint8Array, boolean> }, msgId): number => {
    const ack = acks[msgId];
    if (ack) {
      return ack.size;
    }
    return 0;
  };

  @state()
  _showRecipients = 0;

  renderRecipients(agents: AgentPubKey[]) {
    return html`
      <div
        class="column msg-recipients"
        @mouseleave=${() => {
          console.log('Got mouseout event');
          this._showRecipients = 0;
        }}
      >
        <div class="msg-recipients-title" style="margin-bottom: 2px;">${msg('received by:')}</div>
        <div class="row" style="flex-wrap: wrap;">
          ${agents.map(
            (agent) =>
              html`<agent-avatar
                style="margin-left: 2px; margin-bottom: 2px;"
                .size=${18}
                .agentPubKey=${agent}
              ></agent-avatar>`,
          )}
        </div>
      </div>
    `;
  }

  @query('#foyer-info-dialog')
  _foyerInfoDialog!: SlDialog;

  renderFoyerInfo() {
    return html` <sl-dialog
      id="foyer-info-dialog"
      style="--width: 500px; --sl-panel-background-color: #f0f59d;"
      no-header
    >
      <div class="">
        <div
          class="row"
          style="align-items: center; font-size: 30px; justify-content: center; margin-bottom: 28px;"
        >
          <sl-icon .src=${wrapPathInSvg(mdiSofa)}></sl-icon>
          <sl-icon .src=${wrapPathInSvg(mdiChat)}></sl-icon>
          <span style="margin-left: 5px;">Foyer</span>
        </div>
        <div style="margin-top: 20px; font-size: 20px;">
          <p>The Foyer is a space for sending ephemeral messages to other members of the group.</p>
          <p>
            None of these messages are ever stored, and they only go to other members who show as
            online in the group's member list.
          </p>
        </div>
      </div>
    </sl-dialog>`;
  }

  renderStream() {
    if (!this._messages) return html``;
    if (this._conversationContainer) {
      const scrollTop = this._conversationContainer.scrollTop;
      const scrollHeight = this._conversationContainer.scrollHeight;
      const offsetHeight = this._conversationContainer.offsetHeight;
      const scrolledFromBottom = scrollHeight - (scrollTop + offsetHeight);
      // If not explicitly scrolled up by the user, scroll to the bottom if a new message arrives
      if (scrolledFromBottom < 100) {
        setTimeout(() => {
          this._conversationContainer.scrollTop = this._conversationContainer.scrollHeight;
        }, 100);
        this.newMessages = 0;
        this.previousMessageCount = this._messages.value.length;
      } else {
        const newMessages = this._messages.value.length - this.previousMessageCount;
        if (newMessages > 0) {
          this.newMessages = newMessages;
        }
      }
    }
    return this._messages.value.map((msg) => {
      const isMyMessage = encodeHashToBase64(msg.from) == this.groupStore.foyerStore.myPubKeyB64;
      const msgText = this.convertMessageText((msg.payload as any).text);
      const ackCount = this._acks ? this.getAckCount(this._acks.value, msg.payload.created) : 0;
      return html`
        <div class="row" style="position: relative;">
          ${isMyMessage ? html`<span style="flex: 1;"></span>` : html``}
          <div class=${isMyMessage ? 'my-msg msg' : 'msg'}>
            <div class="msg-content">
              ${msg.payload.type === 'Msg'
                ? html`
                    ${!isMyMessage
                      ? html`
                          <agent-avatar
                            style="margin-right:5px"
                            disable-copy=${true}
                            size=${20}
                            agent-pub-key=${encodeHashToBase64(msg.from)}
                          ></agent-avatar>
                        `
                      : ''}
                    ${msgText}
                    <span
                      title=${`Received: ${new Date(msg.received).toLocaleTimeString()}`}
                      class="msg-timestamp"
                      >${new Date(msg.payload.created).toLocaleTimeString()}</span
                    >
                    <div class="column">
                      ${isMyMessage
                        ? html`
                            ${ackCount > 0
                              ? html`
                                  <div
                                    tabindex="0"
                                    style="margin-top: 1px;"
                                    @mouseover=${() => {
                                      console.log('mouseover');
                                      if (this._showRecipients !== msg.payload.created) {
                                        this._showRecipients = msg.payload.created;
                                      }
                                    }}
                                    @keypress=${(e: KeyboardEvent) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        if (this._showRecipients === msg.payload.created) {
                                          this._showRecipients = 0;
                                        } else {
                                          this._showRecipients = msg.payload.created;
                                        }
                                      }
                                    }}
                                    class="ack-count row center-content ${ackCount > 9
                                      ? 'padded'
                                      : ''}"
                                  >
                                    ${ackCount}
                                  </div>
                                `
                              : '...'}
                          `
                        : ''}
                      <span style="flex: 1;"></span>
                    </div>
                  `
                : ''}
            </div>
            ${this._acks &&
            isMyMessage &&
            ackCount > 0 &&
            this._showRecipients === msg.payload.created
              ? this.renderRecipients(Array.from(this._acks.value[msg.payload.created].keys()))
              : ''}
          </div>
          ${isMyMessage ? html`` : html`<span style="flex: 1;"></span>`}
        </div>
      `;
    });
  }

  render() {
    return html`
      ${this.renderFoyerInfo()}
      <div class="person-feed">
        <div class="header">
          <div class="column">
            <div
              @click=${() => this._foyerInfoDialog.show()}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  this._foyerInfoDialog.show();
                }
              }}
              class="row info"
              style="align-items: center; font-size: 1.5rem; cursor: help;"
            >
              <sl-icon .src=${wrapPathInSvg(mdiSofa)}></sl-icon>
              <sl-icon .src=${wrapPathInSvg(mdiChat)}></sl-icon>
            </div>
            <span>Foyer Messages: ${this._messages ? this._messages.value.length : '0'}</span>
          </div>
          <div style="display:flex; align-items: center"></div>
        </div>
        <div id="stream" class="stream">${this.renderStream()}</div>
        <span style="display: flex; flex: 1;"></span>
        ${this._messages && this.newMessages
          ? html`<div
              tabindex="0"
              class="new-message-indicator"
              @click=${() => {
                this._conversationContainer.scrollTop = this._conversationContainer.scrollHeight;
                this.newMessages = 0;
                this.previousMessageCount = this._messages!.value.length;
              }}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  this._conversationContainer.scrollTop = this._conversationContainer.scrollHeight;
                  this.newMessages = 0;
                  this.previousMessageCount = this._messages!.value.length;
                }
              }}
            >
              ${this.newMessages} new message(s)
            </div>`
          : html``}
        <div class="send-controls">
          <sl-input
            id="msg-input"
            style="width:100%"
            @sl-input=${(e) => {
              this.disabled = !e.target.value || !this._msgInput.value;
            }}
            @keydown=${(e) => {
              if (e.keyCode == 13) {
                this.sendMessage();
                e.stopPropagation();
              }
            }}
            placeholder="Message"
          ></sl-input>
          <sl-button
            style="margin-left:10px;"
            circle
            ${this.disabled ? 'disabled' : ''}
            @click=${() => this.sendMessage()}
          >
            <svg
              style="margin-top:10px"
              xmlns="http://www.w3.org/2000/svg"
              height="16"
              width="16"
              viewBox="0 0 512 512"
            >
              <!--!Font Awesome Free 6.5.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2023 Fonticons, Inc.-->
              <path
                d="M16.1 260.2c-22.6 12.9-20.5 47.3 3.6 57.3L160 376V479.3c0 18.1 14.6 32.7 32.7 32.7c9.7 0 18.9-4.3 25.1-11.8l62-74.3 123.9 51.6c18.9 7.9 40.8-4.5 43.9-24.7l64-416c1.9-12.1-3.4-24.3-13.5-31.2s-23.3-7.5-34-1.4l-448 256zm52.1 25.5L409.7 90.6 190.1 336l1.2 1L68.2 285.7zM403.3 425.4L236.7 355.9 450.8 116.6 403.3 425.4z"
              />
            </svg>
          </sl-button>
        </div>
      </div>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      .info:hover {
        opacity: 0.7;
      }
      .person-feed {
        color: white;
        display: flex;
        flex: 1;
        flex-direction: column;
        width: 100%;
        position: relative;
      }
      .header {
        margin-top: 5px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .stream {
        width: 100%;
        display: flex;
        flex: auto;
        flex-direction: column;
        overflow-y: auto;
      }
      .msg {
        display: flex;
        flex-direction: column;
        margin: 3px 5px;
        border-radius: 10px;
        color: white;
        padding: 3px 10px;
        flex-shrink: 1;
        align-self: flex-start;
        background-color: #305f19;
      }
      .msg-content {
        display: flex;
      }
      a {
        text-decoration: underline;
      }
      .my-msg {
        align-self: flex-end;
        background-color: #72b51b;
      }
      .send-controls {
        display: flex;
        justify-content: flex-end;
        padding: 5px;
      }
      .msg-timestamp {
        margin-left: 4px;
        font-size: 80%;
        color: #ccc;
      }
      .ack-count {
        margin: auto;
        min-width: 16px;
        height: 16px;
        margin-left: 5px;
        background-color: #f3ff3b;
        color: black;
        font-size: 80%;
        border-radius: 50%;
      }

      .padded {
        padding: 0 3px;
      }

      .person-inactive {
        opacity: 0.5;
      }

      .new-message-indicator {
        position: absolute;
        bottom: 60px;
        right: 30px;
        border-radius: 12px;
        background: yellow;
        color: black;
        padding: 4px 8px;
        cursor: pointer;
      }

      .msg-recipients {
        z-index: 1;
        align-items: flex-end;
        position: absolute;
        top: 2px;
        right: 14px;
        background-color: #f3ff3b;
        margin-top: 5px;
        padding: 5px;
        color: white;
        border-radius: 8px;
        max-width: 220px;
      }

      .msg-recipients-title {
        font-size: 10px;
        color: #08230e;
        cursor: default;
      }
    `,
  ];
}

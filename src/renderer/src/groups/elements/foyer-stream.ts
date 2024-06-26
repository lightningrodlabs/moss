import { css, html, LitElement } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { notifyError, sharedStyles } from '@holochain-open-dev/elements';
import { consume } from '@lit/context';
import '@holochain-open-dev/profiles/dist/elements/profiles-context.js';
import '@holochain-open-dev/profiles/dist/elements/my-profile.js';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import SlInput from '@shoelace-style/shoelace/dist/components/input/input.js';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { Payload, Stream } from '../stream.js';
import { HoloHashMap } from '@holochain-open-dev/utils';
import { get, StoreSubscriber } from '@holochain-open-dev/stores';
import { AgentPubKey, decodeHashFromBase64, encodeHashToBase64 } from '@holochain/client';
import { PeerStatus } from '@lightningrodlabs/we-applet';

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
  }

  @state()
  _messages;

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

  renderStream() {
    if (!this._messages) return '';
    return this._messages.value.map((msg) => {
      const isMyMessage = encodeHashToBase64(msg.from) == this.groupStore.foyerStore.myPubKeyB64;
      const msgText = this.convertMessageText(msg.payload.text);
      const ackCount = 19; //getAckCount($acks, msg.payload.created)
      const recipientCount = 19;
      return html`
        <div class=${isMyMessage ? 'my-msg msg' : 'msg'}>
          ${msg.payload.type == 'Msg'
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
                ${isMyMessage
                  ? html`
                      ${ackCount == recipientCount
                        ? '✓'
                        : recipientCount > 1
                          ? html` <span class="ack-count">${ackCount}</span> `
                          : ''}
                    `
                  : ''}
              `
            : ''}
        </div>
      `;
    });
  }

  render() {
    return html`
      <div class="person-feed">
        <div class="header">
          <div>
            <span>Foyer Messages: ${this._messages ? this._messages.value.length : '0'}</span>
          </div>
          <div style="display:flex; align-items: center"></div>
        </div>
        <div id="stream" class="stream">${this.renderStream()}</div>
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
      .person-feed {
        color: white;
        display: flex;
        flex-direction: column;
        width: 100%;
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
        height: calc(100vh - 331px);
      }
      .msg {
        display: flex;
        margin: 5px;
        border-radius: 10px;
        color: white;
        padding: 3px 10px;
        flex-shrink: 1;
        align-self: flex-start;
        background-color: rebeccapurple;
      }
      a {
        text-decoration: underline;
      }
      .my-msg {
        align-self: flex-end;
        background-color: blue;
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
        display: flex;
        justify-content: center;
        margin: auto;
        width: 15px;
        height: 15px;
        margin-left: 5px;
        background-color: yellow;
        color: black;
        font-size: 80%;
        border-radius: 50%;
      }
      .person-inactive {
        opacity: 0.5;
      }
    `,
  ];
}

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
import { AgentPubKey, encodeHashToBase64 } from '@holochain/client';

@localized()
@customElement('foyer-stream')
export class FoyerStream extends LitElement {
  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @state()
  stream: Stream | undefined =
    this.groupStore && this.groupStore.foyerStore
      ? get(this.groupStore.foyerStore.streams)['_all']
      : undefined;

  @query('#msg-input')
  private _msgInput!: SlInput;

  @query('#stream')
  private _conversationContainer!: HTMLElement;

  @state()
  _messages = this.stream
    ? new StoreSubscriber(
        this,
        () => this.stream!.messages,
        () => [this.stream],
      )
    : undefined;

  @state()
  disabled = true;

  getRecipients(): AgentPubKey[] {
    return [];
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

  render() {
    return html`
      <div class="person-feed">
        <div class="header">
          <div>
            <span>Messages: ${this._messages ? this._messages.value.length : '0'}</span>
          </div>
          <div style="display:flex; align-items: center"></div>
        </div>
        <div id="stream" class="stream">
          ${this.stream && this._messages
            ? this._messages.value.map((msg) => {
                const isMyMessage =
                  encodeHashToBase64(msg.from) == this.groupStore.foyerStore.myPubKeyB64;
                const msgText = this.convertMessageText(msg.payload.text);
                const ackCount = 19; //getAckCount($acks, msg.payload.created)
                const recipientCount = 19;
                return html`
                  <div class="msg" class=${isMyMessage ? 'my-msg' : ''}>
                    ${msg.payload.type == 'Msg'
                      ? html`
                          ${!isMyMessage
                            ? html`
                                <agent-avatar
                                  style="margin-right:5px"
                                  disable-copy="{true}"
                                  size="{20}"
                                  agent-pub-key="{encodeHashToBase64(msg.from)}"
                                ></agent-avatar>
                              `
                            : ''}
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
                                    ? html` <span class="ack-count">{ackCount}</span> `
                                    : ''}
                              `
                            : ''}
                        `
                      : ''}
                  </div>
                `;
              })
            : ''}
        </div>
        <div class="send-controls">
          <sl-input
            id="msg-input"
            style="width:100%"
            @sl-input=${(e) => {
              console.log('FISH', e);
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
            ><SvgIcon icon="zipzap" size="20" />
          </sl-button>
        </div>
      </div>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      .person-feed {
        padding-left: 10px;
        display: flex;
        flex-direction: column;
        background-color: lightgoldenrodyellow;
        width: 100%;
      }
      .header {
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
        height: 0px;
      }
      .msg {
        display: flex;
        margin: 5px;
        border-radius: 0px 15px 0px 15px;
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
        border-radius: 15px 0px 15px 0px;
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

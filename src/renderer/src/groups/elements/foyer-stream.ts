import { css, html, LitElement } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { sharedStyles, wrapPathInSvg } from '@holochain-open-dev/elements';
import { consume } from '@lit/context';
import '@holochain-open-dev/profiles/dist/elements/profiles-context.js';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/dropdown/dropdown.js';
import '@shoelace-style/shoelace/dist/components/menu/menu.js';
import '@shoelace-style/shoelace/dist/components/menu-item/menu-item.js';
import SlInput from '@shoelace-style/shoelace/dist/components/input/input.js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { Message, Payload, Stream } from '../stream.js';
import { get, StoreSubscriber } from '@holochain-open-dev/stores';
import { AgentPubKey, HoloHashMap, decodeHashFromBase64, encodeHashToBase64 } from '@holochain/client';
import { mdiChat, mdiMessageCog, mdiSofa } from '@mdi/js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { mossStyles } from '../../shared-styles.js';
import { sendIcon } from '../../elements/_new_design/icons.js';
import {
  FoyerNotificationSettings,
  FoyerMessageUrgency,
  DEFAULT_FOYER_NOTIFICATION_SETTINGS,
} from '../../applets/types.js';

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
    console.log("this.groupStore.foyerStore", this.groupStore.foyerStore)
    // Load notification settings
    this._notificationSettings = this.groupStore.getFoyerNotificationSettingsValue();

    setTimeout(() => {
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
    }, 100);
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

  @state()
  _notificationSettings: FoyerNotificationSettings = DEFAULT_FOYER_NOTIFICATION_SETTINGS;

  @state()
  _showNotificationSettings = false;

  private _boundCloseOnOutsideClick = this._closeOnOutsideClick.bind(this);

  private _closeOnOutsideClick(e: MouseEvent) {
    const panel = this.shadowRoot?.querySelector('.notification-settings-panel');
    const icon = this.shadowRoot?.querySelector('.notification-settings-trigger');
    if (panel && !panel.contains(e.target as Node) && !icon?.contains(e.target as Node)) {
      this._showNotificationSettings = false;
      document.removeEventListener('click', this._boundCloseOnOutsideClick);
    }
  }

  private _toggleNotificationSettings() {
    this._showNotificationSettings = !this._showNotificationSettings;
    if (this._showNotificationSettings) {
      // Delay adding listener to avoid immediate close from the same click
      setTimeout(() => {
        document.addEventListener('click', this._boundCloseOnOutsideClick);
      }, 0);
    } else {
      document.removeEventListener('click', this._boundCloseOnOutsideClick);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._boundCloseOnOutsideClick);
  }

  handleMentionsUrgencyChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value as FoyerMessageUrgency;
    this._notificationSettings = { ...this._notificationSettings, mentions: value };
    this.groupStore.setFoyerNotificationSettings(this._notificationSettings);
  }

  handleAllMessagesUrgencyChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value as FoyerMessageUrgency;
    this._notificationSettings = { ...this._notificationSettings, allMessages: value };
    this.groupStore.setFoyerNotificationSettings(this._notificationSettings);
  }

  getUrgencyLabel(urgency: FoyerMessageUrgency): string {
    switch (urgency) {
      case 'none':
        return msg('Off');
      case 'low':
        return msg('Low');
      case 'medium':
        return msg('Medium');
      case 'high':
        return msg('High');
    }
  }

  getRecipients(): AgentPubKey[] {
    const agents: AgentPubKey[] = [];
    const peers = this._peersStatus.value;
    if (!peers) return [];
    else {
      for (const key in peers) {
        const status = peers[key];
        if (key != this.groupStore.foyerStore.myPubKeyB64 && status.status !== 'offline')
          agents.push(decodeHashFromBase64(key));
      }
    }
    return agents;
  }

  convertMessageText = (text: string): string => {
    let cleaned = text.replace(/&/g, '&amp;');
    cleaned = cleaned.replace(/</g, '&lt;');
    cleaned = cleaned.replace(/>/g, '&gt;');
    cleaned = cleaned.replace(/https:\/\/theweave\.social\/wal\?weave/g, 'weave');
    let formatted = cleaned.replace(
      /([a-z0-9-.]+:\/\/[^\s]+)/g,
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
          <span style="margin-left: 5px;">${msg('Foyer')}</span>
        </div>
        <div style="margin-top: 20px; font-size: 20px;">
          <p>${msg('The Foyer is a space for sending ephemeral messages to other members of the group.')}</p>
          <p>
            ${msg('None of these messages are ever stored, and they only go to other members who show as online in the group\'s member list.')}
          </p>
        </div>
      </div>
    </sl-dialog>`;
  }

  renderStream() {
    if (!this._messages) return html`...`;
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
          ${!isMyMessage
          ? html`
                <agent-avatar
                  style="margin-right:5px"
                  disable-copy=${true}
                  size=${32}
                  agent-pub-key=${encodeHashToBase64(msg.from)}
                ></agent-avatar>
              `
          : ''}
          <div class=${isMyMessage ? 'my-msg msg' : 'msg'}>
            <div class="msg-content">
              ${msg.payload.type === 'Msg'
          ? html`
                    ${unsafeHTML(msgText)}
                    <div class="msg-meta">
                      <span
                        class="msg-timestamp"
                        title=${`Received: ${new Date(msg.received).toLocaleTimeString()}`}
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
            </div>
            <span>${msg('Foyer Messages:')} ${this._messages ? this._messages.value.length : '0'}</span>
          </div>
          <div style="display:flex; align-items: center; margin-right: 8px; position: relative;">
            <sl-icon
              class="info notification-settings-trigger"
              .src=${wrapPathInSvg(mdiMessageCog)}
              style="font-size: 1.5rem; color: black; cursor: pointer;"
              title=${msg('Notification Settings')}
              @click=${() => this._toggleNotificationSettings()}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  this._toggleNotificationSettings();
                }
              }}
              tabindex="0"
            ></sl-icon>
            ${this._showNotificationSettings ? html`
              <div class="notification-settings-panel">
                <div class="notification-settings-header">${msg('Notification Settings')}</div>
                <div class="notification-settings-row">
                  <span class="notification-settings-label">${msg('Mentions')}</span>
                  <select
                    class="notification-settings-select"
                    .value=${this._notificationSettings.mentions}
                    @change=${this.handleMentionsUrgencyChange}
                  >
                    <option value="high" ?selected=${this._notificationSettings.mentions === 'high'}>${msg('High')}</option>
                    <option value="medium" ?selected=${this._notificationSettings.mentions === 'medium'}>${msg('Medium')}</option>
                    <option value="low" ?selected=${this._notificationSettings.mentions === 'low'}>${msg('Low')}</option>
                    <option value="none" ?selected=${this._notificationSettings.mentions === 'none'}>${msg('Off')}</option>
                  </select>
                </div>
                <div class="notification-settings-row">
                  <span class="notification-settings-label">${msg('All messages')}</span>
                  <select
                    class="notification-settings-select"
                    .value=${this._notificationSettings.allMessages}
                    @change=${this.handleAllMessagesUrgencyChange}
                  >
                    <option value="high" ?selected=${this._notificationSettings.allMessages === 'high'}>${msg('High')}</option>
                    <option value="medium" ?selected=${this._notificationSettings.allMessages === 'medium'}>${msg('Medium')}</option>
                    <option value="low" ?selected=${this._notificationSettings.allMessages === 'low'}>${msg('Low')}</option>
                    <option value="none" ?selected=${this._notificationSettings.allMessages === 'none'}>${msg('Off')}</option>
                  </select>
                </div>
                <div class="notification-settings-hint">
                  ${msg('High = OS notification, Medium = systray, Low = feed only')}
                </div>
              </div>
            ` : ''}
          </div>
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
            style="flex: 1;"
            @sl-input=${() => {
        this.disabled = !this._msgInput?.value;
      }}
            @keydown=${(e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          this.sendMessage();
          e.stopPropagation();
        }
      }}
            placeholder=${msg('my message')}
          ></sl-input>
          <button
            class="moss-button send-button"
            ?disabled=${this.disabled}
            @click=${() => this.sendMessage()}
          >
            <div class="column center-content" style="padding-top: 2px;">${sendIcon(18)}</div>
          </button>
        </div>
      </div>
    `;
  }

  static styles = [
    sharedStyles,
    mossStyles,
    css`
      .info:hover {
        opacity: 0.7;
      }
      .person-feed {
        color: black;
        display: flex;
        flex: 1;
        flex-direction: column;
        width: 100%;
        min-width: 0;
        position: relative;
        overflow: hidden;
      }
      .header {
        margin-top: 5px;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
      }
      .stream {
        width: 100%;
        display: flex;
        flex: auto;
        flex-direction: column;
        overflow-y: auto;
        overflow-x: hidden;
      }
      .msg {
        display: flex;
        flex-direction: column;
        margin: 3px 5px;
        border-radius: 10px;
        color: black;
        padding: 3px 10px;
        flex-shrink: 1;
        align-self: flex-start;
        background-color: white;
        max-width: calc(100% - 10px);
        word-wrap: break-word;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .msg-content {
        display: flex;
        flex-direction: column;
        font-size: 16px;
        word-wrap: break-word;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      a {
        text-decoration: underline;
        color: black;
      }
      .my-msg {
        align-self: flex-end;
        background-color: #7461eb;
        color: white;
      }
      .my-msg a {
        color: white;
      }

      .send-controls {
        display: flex;
        justify-content: flex-end;
        padding: 5px;
        gap: 8px;
      }

      .send-button {
        padding: 0 11px;
        border-radius: 9px;
        flex-shrink: 0;
      }
      .msg-meta {
        display: flex;
        flex-direction: row;
        align-self: flex-end;
      }
      .msg-timestamp {
        margin-left: 4px;
        font-size: 12px;
        font-weight: 500;
        color: rgba(50, 77, 71, 1);
      }
      .my-msg .msg-timestamp {
        color: #e0eed5;
      }
      .ack-count {
        margin: auto;
        min-width: 14px;
        height: 14px;
        margin-left: 5px;
        background-color: rgba(1, 1, 1, 16%);
        color: rgba(224, 238, 213, 1);
        font-size: 11px;
        border-radius: 4px;
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
        top: 20px;
        right: 5px;
        background-color: #bac9af;
        margin-top: 5px;
        padding: 5px;
        color: white;
        border-radius: 4px;
        max-width: 220px;
      }
      .msg-recipients-title {
        font-size: 10px;
        color: #08230e;
        cursor: default;
      }

      .notification-settings-panel {
        position: absolute;
        top: 30px;
        right: 0;
        background: white;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 12px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 100;
        min-width: 220px;
      }

      .notification-settings-header {
        font-weight: 600;
        font-size: 13px;
        margin-bottom: 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid #eee;
      }

      .notification-settings-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }

      .notification-settings-label {
        font-size: 13px;
      }

      .notification-settings-select {
        padding: 4px 8px;
        border-radius: 4px;
        border: 1px solid #ccc;
        font-size: 12px;
        min-width: 80px;
        cursor: pointer;
      }

      .notification-settings-select:hover {
        border-color: #999;
      }

      .notification-settings-hint {
        font-size: 11px;
        color: #666;
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid #eee;
      }
    `,
  ];
}

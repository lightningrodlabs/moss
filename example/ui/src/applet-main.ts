import { LitElement, css, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';

import { localized } from '@lit/localize';
import { sharedStyles } from '@holochain-open-dev/elements';

import './elements/all-posts.js';
import './elements/create-post.js';
import {
  type WAL,
  type FrameNotification,
  WeClient,
  weaveUrlToLocation,
} from '@lightningrodlabs/we-applet';
import { AppClient } from '@holochain/client';
import '@lightningrodlabs/we-elements/dist/elements/wal-embed.js';

@localized()
@customElement('applet-main')
export class AppletMain extends LitElement {
  @property()
  client!: AppClient;

  @property()
  weClient!: WeClient;

  @query('#wal-input-field')
  walInputField!: HTMLInputElement;

  @query('#wal-embed-input-field')
  walEmbedInputField!: HTMLInputElement;

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
  // @state()
  // unsubscribe: undefined | (() => void);

  // firstUpdated() {
  //   // console.log("@firstUpdated in example applet: Hello.");
  //   this.unsubscribe = this.client.on("signal", (signal) => console.log("Received signal: ", signal));
  // }

  // disconnectedCallback(): void {
  //   if (this.unsubscribe) this.unsubscribe();
  // }

  updateWalLink() {
    this.walLink = this.walInputField.value;
  }

  updateWalEmbedLink() {
    this.walEmbedLink = this.walEmbedInputField.value;
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

  async userSelectWal() {
    const selectedWal = await this.weClient.userSelectWal();
    this.selectedWal = selectedWal;
  }

  render() {
    return html`
      <div class="column" style="margin-bottom: 500px;">
        <div class="row">
          <div class="column">
            <create-post style="margin: 16px;"></create-post>
            <button @click=${() => this.sendLowNotification(5000)}>
              Send Low Urgency Notification with 5 seconds delay
            </button>
            <button @click=${() => this.sendMediumNotification(5000)}>
              Send Medium Urgency Notification with 5 seconds delay
            </button>
            <button @click=${() => this.sendUrgentNotification(5000)}>
              Send High Urgency Notification with 5 seconds delay
            </button>
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
            <button
              @click=${() => {
                navigator.clipboard.writeText('Easter Egg.');
              }}
            >
              Copy Something To Clipboard
            </button>

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
                  await this.weClient.requestBind(srcWal.wal, dstWal.wal);
                }}
              >
                Bind!
              </button>
            </div>

            <div style="border: 1px solid black; padding: 5px; border-radius: 5px; margin: 10px 0;">
              <div><b>Embed WAL:</b></div>
              <div class="row" style="margin-bottom: 10px;">
                <input id="wal-embed-input-field" type="text" rows="4" cols="50" />
                <button
                  @click=${() => {
                    this.updateWalEmbedLink();
                  }}
                  style="width: 100px; margin-left: 5px;"
                >
                  Embed
                </button>
              </div>
              ${this.walEmbedLink !== ''
                ? html`
                    <wal-embed
                      style="margin-top: 20px;"
                      .src=${this.walEmbedLink}
                      closable
                      @open-in-sidebar=${() => console.log('Opening in sidebar')}
                      @close=${() => console.log('Closing requested')}
                    ></wal-embed>
                  `
                : html``}
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

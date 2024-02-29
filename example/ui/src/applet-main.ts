import { LitElement, css, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';

import { localized } from '@lit/localize';
import { sharedStyles } from '@holochain-open-dev/elements';

import './elements/all-posts.js';
import './elements/create-post.js';
import { type HrlWithContext, type WeNotification, WeClient } from '@lightningrodlabs/we-applet';
import { AppAgentClient, decodeHashFromBase64 } from '@holochain/client';
import '@lightningrodlabs/we-elements/dist/elements/wal-embed.js';
import { decodeContext } from '@lightningrodlabs/we-elements';

@localized()
@customElement('applet-main')
export class AppletMain extends LitElement {
  @property()
  client!: AppAgentClient;

  @property()
  weClient!: WeClient;

  @query('#hrl-input-field')
  hrlInputField!: HTMLInputElement;

  @query('#wal-embed-input-field')
  walEmbedInputField!: HTMLInputElement;

  @state()
  mediumInterval: number | null = null;

  @state()
  highInterval: number | null = null;

  @state()
  selectedHrl: HrlWithContext | undefined = undefined;

  @state()
  hrlLink: string = '';

  @state()
  walEmbedLink: string = '';

  @state()
  embedHrlWithContext: HrlWithContext | undefined;

  // @state()
  // unsubscribe: undefined | (() => void);

  // firstUpdated() {
  //   // console.log("@firstUpdated in example applet: Hello.");
  //   this.unsubscribe = this.client.on("signal", (signal) => console.log("Received signal: ", signal));
  // }

  // disconnectedCallback(): void {
  //   if (this.unsubscribe) this.unsubscribe();
  // }

  updateHrlLink() {
    this.hrlLink = this.hrlInputField.value;
  }

  updateWalEmbedLink() {
    this.walEmbedLink = this.walEmbedInputField.value;
    try {
      this.embedHrlWithContext = this.urlToWal(this.walEmbedLink);
    } catch (e) {}
  }

  sendUrgentNotification(delay: number) {
    const notification: WeNotification = {
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
      const notification: WeNotification = {
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
    const notification: WeNotification = {
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

  async userSelectHrl() {
    const selectedHrl = await this.weClient.userSelectHrl();
    this.selectedHrl = selectedHrl;
  }

  urlToWal(url: string): HrlWithContext {
    if (!url.startsWith('we://')) {
      throw new Error(`Invalid URL. we:// URL required but got '${url}'`);
    }

    const split = url.split('://');
    // ['we', 'hrl/uhC0k-GO_J2D51Ibh2jKjVJHAHPadV7gndBwrqAmDxRW3b…kzMgM3yU2RkmaCoiY8IVcUQx_TLOjJe8SxJVy7iIhoVIvlZrD']
    const split2 = split[1].split('/');
    // ['hrl', 'uhC0k-GO_J2D51Ibh2jKjVJHAHPadV7gndBwrqAmDxRW3buMpVRa9', 'uhCkkzMgM3yU2RkmaCoiY8IVcUQx_TLOjJe8SxJVy7iIhoVIvlZrD']

    if (split2[0] === 'hrl') {
      const contextSplit = split2[2].split('?context=');
      return {
        hrl: [decodeHashFromBase64(split2[1]), decodeHashFromBase64(contextSplit[0])],
        context: contextSplit[1] ? decodeContext(contextSplit[1]) : undefined,
      };
    } else {
      throw new Error('This input field only accepts URLs pointing to a WAL.');
    }
  }

  render() {
    return html`
      <div class="column">
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
            <div>Enter Hrl:</div>
            <textarea
              id="hrl-input-field"
              type="text"
              @input=${() => this.updateHrlLink()}
              rows="4"
              cols="50"
            ></textarea>
            <button>Update HRL Link</button>
            <a href="${this.hrlLink}"
              >${this.hrlLink ? this.hrlLink : 'Paste HRL in field above to update me'}</a
            >
            <a href="${this.hrlLink}" target="_blank"
              >${this.hrlLink ? this.hrlLink : 'Paste HRL in field above to update me'}</a
            >
            <a href="https://duckduckgo.com">duckduckgo.com</a>
            <a href="https://duckduckgo.com" traget="_blank">duckduckgo.com</a>

            <div>Embed Hrl:</div>
            <input
              id="wal-embed-input-field"
              type="text"
              @input=${() => {
                this.updateWalEmbedLink();
              }}
              rows="4"
              cols="50"
            />
            ${this.embedHrlWithContext
              ? html`
                  <wal-embed
                    .weClient=${this.weClient}
                    .hrlWithContext=${this.embedHrlWithContext}
                  ></wal-embed>
                `
              : html``}
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

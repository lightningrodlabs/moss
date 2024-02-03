import { html, LitElement, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@holochain-open-dev/profiles/dist/elements/profile-detail.js';

import './select-group-dialog.js';
import '../applets/elements/applet-logo.js';
import '../applets/elements/applet-title.js';
import '../groups/elements/group-context.js';

import { consume } from '@lit/context';
import { decodeHashFromBase64 } from '@holochain/client';
import { AppletNotification, GroupDnaHash } from '../types.js';
import { weStoreContext } from '../context.js';
import { WeStore } from '../we-store.js';
import TimeAgo from 'javascript-time-ago';
import { weStyles } from '../shared-styles.js';
import { stringToMessageParts } from '../utils.js';
import { toPromise } from '@holochain-open-dev/stores';

@localized()
@customElement('feed-element')
export class FeedElement extends LitElement {
  @consume({ context: weStoreContext })
  @state()
  _weStore!: WeStore;

  @property()
  notification!: AppletNotification;

  /**
   * Just pick one of the group's this applet is part of in order to be able to display a profile
   */
  @state()
  groupDnaHash: GroupDnaHash | undefined;

  @state()
  loading = true;

  async firstUpdated() {
    try {
      const groupsForApplet = await toPromise(
        this._weStore.groupsForApplet.get(decodeHashFromBase64(this.notification.appletId)),
      );
      const groupHashes = Array.from(groupsForApplet.keys());
      if (groupHashes.length > 0) {
        this.groupDnaHash = groupHashes[0];
      }
      this.loading = false;
    } catch (e) {
      console.warn('@feed-element: Failed to get groups for applet: ', e);
    }
  }

  render() {
    const timeAgo = new TimeAgo('en-US');
    const messageParts = stringToMessageParts(this.notification.notification.body);
    return html`
      <div
        class="column notification"
        tabindex="0"
        @click=${() =>
          this.dispatchEvent(
            new CustomEvent('applet-selected', {
              detail: {
                appletHash: decodeHashFromBase64(this.notification.appletId),
              },
              bubbles: true,
              composed: true,
            }),
          )}
        @keypress=${(e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            this.dispatchEvent(
              new CustomEvent('applet-selected', {
                detail: {
                  appletHash: decodeHashFromBase64(this.notification.appletId),
                },
                bubbles: true,
                composed: true,
              }),
            );
          }
        }}
      >
        <div class="row">
          <applet-title
            .appletHash=${decodeHashFromBase64(this.notification.appletId)}
            style="--size: 35px; font-size: 18px;"
          ></applet-title>
          <span style="display: flex; flex: 1;"></span>${timeAgo.format(
            this.notification.notification.timestamp,
          )}
        </div>
        <div
          class="row"
          style="align-items: center; margin-top: 6px; font-size: 20px; font-weight: bold;"
        >
          <span>${this.notification.notification.title}</span>
          <span style="display: flex; flex: 1;"></span>
          ${this.notification.notification.icon_src
            ? html`<img
                .src=${this.notification.notification.icon_src}
                style="height: 24px; width: 24px;"
              />`
            : html``}

          <span style="font-weight: normal; font-size: 18px; margin-left: 6px;"
            >${this.notification.notification.notification_type}</span
          >
        </div>
        <div class="row" style="display:flex; flex: 1; align-items: center; margin-top: 5px;">
          ${messageParts.map((part) => {
            switch (part.type) {
              case 'text':
                return html`${part.content}`;
              case 'agent':
                if (this.loading) return html`[loading...]`;
                if (!this.groupDnaHash) return html`[unknown]`;
                return html`
                  <group-context .groupDnaHash=${this.groupDnaHash}>
                    <profile-detail
                      style="margin: 0 8px; color: darkblue; font-weight: bold;"
                      .agentPubKey=${decodeHashFromBase64(part.pubkey)}
                    ></profile-detail>
                  </group-context>
                `;
            }
          })}
          <span style="display:flex; flex: 1;"></span>
        </div>
      </div>
    `;
  }

  static styles = [
    css`
      .btn {
        all: unset;
        margin: 12px;
        font-size: 25px;
        height: 100px;
        min-width: 300px;
        background: var(--sl-color-primary-800);
        color: white;
        border-radius: 10px;
        cursor: pointer;
        box-shadow: 0 2px 5px var(--sl-color-primary-900);
      }

      .btn:hover {
        background: var(--sl-color-primary-700);
      }

      .btn:active {
        background: var(--sl-color-primary-600);
      }

      .feed {
        max-height: calc(100vh - 330px);
        overflow-y: auto;
      }

      .notification {
        width: calc(100vw - 160px);
        padding: 10px;
        border-radius: 10px;
        background: var(--sl-color-primary-100);
        margin: 5px;
        box-shadow: 1px 1px 3px #8a8a8a;
        cursor: pointer;
      }

      .notification:hover {
        background: var(--sl-color-primary-200);
      }
    `,
    weStyles,
  ];
}

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
        <div class="row" style="align-items: center; justify-content: space-between; width: 100%; opacity: .7;">
          <div style=" display: flex; align-items: center;">
            <applet-title
              .appletHash=${decodeHashFromBase64(this.notification.appletId)}
              style="--size: 18px; font-size: 12px; color: #fff; display: inline-block;"
            ></applet-title>
            <span style="font-size: 12px; display; inline-block; padding-left: 5px;">- ${this.notification.notification.title}</span>
          </div>
          <span style="font-size: 12px; padding-right: 10px;">${timeAgo.format(
            this.notification.notification.timestamp,
          )}</span>
        </div>
        <div
          class="row"
          style="align-items: center; margin-top: 6px; font-size: 14px; font-weight: bold;"
        >
          <span style="display: flex; flex: 1;"></span>
          ${this.notification.notification.icon_src
            ? html`<img
                .src=${this.notification.notification.icon_src}
                style="height: 24px; width: 24px;"
              />`
            : html``}

          <!-- <span style="font-weight: normal; font-size: 18px; margin-left: 6px;"
             >${this.notification.notification.notification_type}</span
           >
           I'm not sure this is necessary with notification.notification.title already here -Aaron
          -->
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
                      style="margin: 0 8px 0 0; color: white; font-weight: 900;"
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
        padding: 10px;
        border-radius: 10px;
        background: rgba(22, 35, 17, 1.0);
        margin: 5px;
        border: 2px solid 
        cursor: pointer;
        color: #fff;
        border: 2px solid rgba(96, 124, 4, .50);
        transition: all .25s ease;
      }

      .notification:hover {
        background-color: rgba(96, 124, 4, 1.0);
        cursor: pointer;
      }
    `,
    weStyles,
  ];
}

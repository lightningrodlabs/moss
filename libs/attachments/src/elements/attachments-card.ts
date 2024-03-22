import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { sharedStyles } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/card/card.js';

import './attachments-list.js';
import './add-outgoing-link.js';
import { Wal } from '../attachments-client.js';

@localized()
@customElement('attachments-card')
export class AttachmentsCard extends LitElement {
  @property()
  wal!: Wal;

  render() {
    return html`
      <sl-card style="flex: 1">
        <div class="column">
          <div class="row" style="align-items: center; margin-bottom: 20px;" slot="header">
            <span style="flex: 1; margin-right: 20px;" class="title">${msg('Attachments')}</span>

            <add-outgoing-link .wal=${this.wal} style="margin-right: 4px;"></add-outgoing-link>
          </div>
          <attachments-list .wal=${this.wal} style="flex: 1"></attachments-list>
        </div>
      </sl-card>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
      }
    `,
  ];
}

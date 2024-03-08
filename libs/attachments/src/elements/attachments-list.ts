import {
  hashProperty,
  notifyError,
  sharedStyles,
  wrapPathInSvg,
} from '@holochain-open-dev/elements';
import { consume } from '@lit/context';
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg } from '@lit/localize';
import { AnyDhtHash } from '@holochain/client';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { mdiAttachmentRemove } from '@mdi/js';

import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';

import { WeClient, WAL, WeServices } from '@lightningrodlabs/we-applet';
import { weClientContext } from '@lightningrodlabs/we-elements';
import '@lightningrodlabs/we-elements/dist/elements/wal-link.js';

import { AttachmentsStore } from '../attachments-store';
import { attachmentsStoreContext } from '../context';

@customElement('attachments-list')
export class AttachmentsList extends LitElement {
  @consume({ context: attachmentsStoreContext, subscribe: true })
  attachmentsStore!: AttachmentsStore;

  @consume({ context: weClientContext, subscribe: true })
  weClient!: WeClient | WeServices;

  @property(hashProperty('hash'))
  hash!: AnyDhtHash;

  attachments = new StoreSubscriber(
    this,
    () => this.attachmentsStore.attachments.get(this.hash),
    () => [this.hash],
  );

  @state()
  _attachmentToRemove: WAL | undefined;

  @state()
  removing = false;

  async removeAttachment(attachmentToRemove: WAL) {
    this.removing = true;

    try {
      await this.attachmentsStore.client.removeAttachment(this.hash, attachmentToRemove);
      this._attachmentToRemove = undefined;
    } catch (e) {
      notifyError(msg('Error removing the attachment'));
      console.error(e);
    }

    this.removing = false;
  }

  renderAttachments(attachments: Array<WAL>) {
    if (attachments.length === 0)
      return html`<span class="placeholder">${msg('There are no attachments yet.')}</span>`;

    return html`
      ${this._attachmentToRemove
        ? html`
            <sl-dialog
              open
              .label=${msg('Remove Attachment')}
              @sl-hide=${() => {
                this._attachmentToRemove = undefined;
              }}
              @sl-request-close=${(e) => {
                if (this.removing) {
                  e.preventDefault();
                }
              }}
            >
              <span>${msg('Do you want to remove this attachment?')}</span>

              <sl-button
                slot="footer"
                @click=${() => {
                  this._attachmentToRemove = undefined;
                }}
                >${msg('Cancel')}</sl-button
              >

              <sl-button
                slot="footer"
                variant="primary"
                @click=${() => this.removeAttachment(this._attachmentToRemove!)}
                .loading=${this.removing}
                >${msg('Remove')}</sl-button
              >
            </sl-dialog>
          `
        : html``}

      <div class="column">
        ${attachments.map(
          (attachment) =>
            html` <div class="row">
              <wal-link
                style="flex:1"
                .hrl=${attachment.hrl}
                .context=${attachment.context}
              ></wal-link>
              <sl-icon-button
                .src=${wrapPathInSvg(mdiAttachmentRemove)}
                @click=${() => (this._attachmentToRemove = attachment)}
              ></sl-icon-button>
            </div>`,
        )}
      </div>
    `;
  }

  render() {
    switch (this.attachments.value.status) {
      case 'pending':
        return html`<sl-skeleton style="margin-bottom: 16px"></sl-skeleton
          ><sl-skeleton style="margin-bottom: 16px"></sl-skeleton><sl-skeleton></sl-skeleton>`;
      case 'complete':
        return this.renderAttachments(this.attachments.value.value);
      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching the attachments')}
          .error=${this.attachments.value.error}
        ></display-error>`;
    }
  }

  static styles = [sharedStyles];
}

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
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { mdiAttachmentRemove } from '@mdi/js';

import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';

import { WeaveUrl } from '@lightningrodlabs/we-applet';
import '@lightningrodlabs/we-elements/dist/elements/wal-link.js';

import { AttachmentsStore } from '../attachments-store';
import { attachmentsStoreContext } from '../context';
import { Wal } from '../attachments-client';

@customElement('attachments-list')
export class AttachmentsList extends LitElement {
  @consume({ context: attachmentsStoreContext, subscribe: true })
  attachmentsStore!: AttachmentsStore;

  @property()
  wal!: WeaveUrl;

  outgoingLinks = new StoreSubscriber(
    this,
    () => this.attachmentsStore.outgoingLinks.get(this.wal),
    () => [this.wal],
  );

  @state()
  _outgoingLinkToRemove: Wal | undefined;

  @state()
  removing = false;

  async removeOutgoingLink(dstWal: Wal) {
    this.removing = true;

    try {
      await this.attachmentsStore.client.removeOutgoingLink({
        src_wal: this.wal,
        dst_wal: dstWal,
      });
      this._outgoingLinkToRemove = undefined;
    } catch (e) {
      notifyError(msg('Error removing the attachment'));
      console.error(e);
    }

    this.removing = false;
  }

  renderAttachments(outgoingLinks: Array<Wal>) {
    if (outgoingLinks.length === 0)
      return html`<span class="placeholder">${msg('There are no attachments yet.')}</span>`;

    return html`
      ${this._outgoingLinkToRemove
        ? html`
            <sl-dialog
              open
              .label=${msg('Remove Attachment')}
              @sl-hide=${() => {
                this._outgoingLinkToRemove = undefined;
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
                  this._outgoingLinkToRemove = undefined;
                }}
                >${msg('Cancel')}</sl-button
              >

              <sl-button
                slot="footer"
                variant="primary"
                @click=${() => this.removeOutgoingLink(this._outgoingLinkToRemove!)}
                .loading=${this.removing}
                >${msg('Remove')}</sl-button
              >
            </sl-dialog>
          `
        : html``}

      <div class="column">
        ${outgoingLinks.map(
          (outgoingLink) =>
            html` <div class="row">
              <wal-link style="flex:1" .wal=${outgoingLink}></wal-link>
              <sl-icon-button
                .src=${wrapPathInSvg(mdiAttachmentRemove)}
                @click=${() => (this._outgoingLinkToRemove = outgoingLink)}
              ></sl-icon-button>
            </div>`,
        )}
      </div>
    `;
  }

  render() {
    switch (this.outgoingLinks.value.status) {
      case 'pending':
        return html`<sl-skeleton style="margin-bottom: 16px"></sl-skeleton
          ><sl-skeleton style="margin-bottom: 16px"></sl-skeleton><sl-skeleton></sl-skeleton>`;
      case 'complete':
        return this.renderAttachments(this.outgoingLinks.value.value);
      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching the attachments')}
          .error=${this.outgoingLinks.value.error}
        ></display-error>`;
    }
  }

  static styles = [sharedStyles];
}

import {
  hashProperty,
  notify,
  notifyError,
  sharedStyles,
  wrapPathInSvg,
} from '@holochain-open-dev/elements';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { mdiPaperclipPlus } from '@mdi/js';
import { msg, localized } from '@lit/localize';
import { AnyDhtHash } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/dropdown/dropdown.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/menu/menu.js';
import '@shoelace-style/shoelace/dist/components/menu-item/menu-item.js';
import '@shoelace-style/shoelace/dist/components/menu-label/menu-label.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';

// TODO: remove alternative menu when sl-menu includes submenus
import '@material/web/menu/menu.js';
import '@material/web/menu/menu-item.js';

import { WeClient, WeServices } from '@lightningrodlabs/we-applet';
import { weClientContext } from '@lightningrodlabs/we-elements';

import { AttachmentsStore } from '../attachments-store';
import { attachmentsStoreContext } from '../context';

@localized()
@customElement('add-attachment')
export class AddAttachment extends LitElement {
  @consume({ context: attachmentsStoreContext, subscribe: true })
  attachmentsStore!: AttachmentsStore;

  @consume({ context: weClientContext, subscribe: true })
  weClient!: WeClient | WeServices;

  @property(hashProperty('hash'))
  hash!: AnyDhtHash;

  async addAttachment() {
    try {
      const wal = await this.weClient.userSelectWal();
      if (wal) {
        await this.attachmentsStore.client.addAttachment(this.hash, wal);
        notify(msg('Asset attached.'));
      }
    } catch (e) {
      notifyError(msg('Error creating the attachment'));
      console.error(e);
    }
  }

  render() {
    return html`
      <sl-tooltip content="Attach existing asset">
        <div
          class="row btn"
          tabindex="0"
          @click=${() => this.addAttachment()}
          @keypress=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              this.addAttachment();
            }
          }}
        >
          <sl-icon .src=${wrapPathInSvg(mdiPaperclipPlus)}></sl-icon>
        </div>
      </sl-tooltip>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      .btn {
        align-items: center;
        background: white;
        padding: 9px;
        border-radius: 50%;
        box-shadow: 1px 1px 3px #6b6b6b;
        cursor: pointer;
      }

      .btn:hover {
        background: #e4e4e4;
      }
    `,
  ];
}

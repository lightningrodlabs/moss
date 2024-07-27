import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized } from '@lit/localize';
import { ActionHashB64, decodeHashFromBase64 } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import '../groups/elements/group-context.js';
import '../elements/topbar-button.js';
import './create-group-dialog.js';

import { mossStoreContext } from '../context.js';
import { MossStore } from '../moss-store.js';
import { weStyles } from '../shared-styles.js';

// Sidebar for the applet instances of a group
@localized()
@customElement('tool-personal-bar-button')
export class PersonalViewSidebar extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @property()
  originalToolActionHash!: ActionHashB64;

  @property()
  selected = false;

  toolBundle = new StoreSubscriber(
    this,
    () =>
      this._mossStore.toolsLibraryStore.installableTools.get(
        decodeHashFromBase64(this.originalToolActionHash),
      ),
    () => [this.originalToolActionHash],
  );

  render() {
    return html`
      <topbar-button
        .invertColors=${true}
        style="margin-left: -4px; position: relative;"
        .selected=${this.selected}
        .tooltipText=${this.toolBundle.value.status === 'complete'
          ? this.toolBundle.value.value?.record.entry.title
          : undefined}
        placement="bottom"
      >
        <applet-logo-raw
          .toolIdentifier=${{
            type: 'class',
            originalToolActionHash: this.originalToolActionHash,
          }}
          placement="bottom"
          style="margin: 4px; --size: 58px;"
        >
        </applet-logo-raw>
      </topbar-button>
      <!-- </sl-tooltip> -->
    `;
  }

  static styles = [
    weStyles,
    css`
      :host {
        display: flex;
      }
    `,
  ];
}

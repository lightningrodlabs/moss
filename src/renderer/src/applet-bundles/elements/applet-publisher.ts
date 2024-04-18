import { AsyncReadable, StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { msg } from '@lit/localize';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import { ActionHash } from '@holochain/client';
import { hashProperty } from '@holochain-open-dev/elements';

import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { weStyles } from '../../shared-styles.js';
import { Entity, PublisherEntry } from '../../processes/appstore/types.js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

const INFO_ICON = `<svg width="20px" height="20px" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path fill="bla" d="M512 64a448 448 0 1 1 0 896.064A448 448 0 0 1 512 64zm67.2 275.072c33.28 0 60.288-23.104 60.288-57.344s-27.072-57.344-60.288-57.344c-33.28 0-60.16 23.104-60.16 57.344s26.88 57.344 60.16 57.344zM590.912 699.2c0-6.848 2.368-24.64 1.024-34.752l-52.608 60.544c-10.88 11.456-24.512 19.392-30.912 17.28a12.992 12.992 0 0 1-8.256-14.72l87.68-276.992c7.168-35.136-12.544-67.2-54.336-71.296-44.096 0-108.992 44.736-148.48 101.504 0 6.784-1.28 23.68.064 33.792l52.544-60.608c10.88-11.328 23.552-19.328 29.952-17.152a12.8 12.8 0 0 1 7.808 16.128L388.48 728.576c-10.048 32.256 8.96 63.872 55.04 71.04 67.84 0 107.904-43.648 147.456-100.416z"/></svg>`;

@customElement('applet-publisher')
export class AppletPublisher extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @property(hashProperty('publisher-hash'))
  publisherHash!: ActionHash;

  publisher = new StoreSubscriber(
    this,
    () => this._mossStore.appletBundlesStore.allPublishers.get(this.publisherHash),
    () => [this.publisherHash],
  );

  get publisherDetailsDialog(): SlDialog {
    return this.shadowRoot?.getElementById('publisher-details-dialog') as SlDialog;
  }

  renderPublisher(publisher: Entity<PublisherEntry>) {
    if (!publisher) return html``;

    return html` <sl-dialog
        id="publisher-details-dialog"
        .label=${publisher.content.name}
        @click=${(e) => {
          e.stopPropagation();
        }}
      >
        <span><a href="${publisher.content.website.url}">${publisher.content.website.url}</a></span>
      </sl-dialog>

      <div class="row">
        <img
          alt="${publisher.content.name}"
          .src=${publisher.content.icon_src}
          style="width: 40px; height: 40px; border-radius: 10px; margin-left: 10px;"
        />
        <div style="margin-left:5px">${publisher.content.name}
        <sl-icon-button
          style="font-size:20px;vertical-align:middle"
          .src=${`data:image/svg+xml;charset=utf-8,${INFO_ICON}`}
          @click=${(e) => {
            this.publisherDetailsDialog.show();
            e.stopPropagation();
          }}
        ></div>
        </sl-icon-button>
      </div>`;
  }

  render() {
    switch (this.publisher.value.status) {
      case 'pending':
        return html``;
      case 'complete':
        return this.renderPublisher(this.publisher.value.value);
      case 'error':
        return html`<display-error
          tooltip
          .headline=${msg('Error fetching the publisher information')}
          .error=${this.publisher.value.error}
        ></display-error>`;
    }
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

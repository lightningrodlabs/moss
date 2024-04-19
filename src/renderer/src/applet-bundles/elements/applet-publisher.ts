import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import { ActionHash } from '@holochain/client';
import { hashProperty, wrapPathInSvg } from '@holochain-open-dev/elements';

import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { weStyles } from '../../shared-styles.js';
import { Entity, PublisherEntry } from '../../processes/appstore/types.js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import { mdiInformationVariantCircle } from '@mdi/js';

@localized()
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
        @keypress=${(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
          }
        }}
      >
        <div class="row" style="align-items: center;">
          <span style="margin-right: 5px;">${msg('website')}:</span>
          ${publisher.content.website.url && publisher.content.website.url !== ''
            ? html`
                <span
                  ><a href="${publisher.content.website.url}"
                    >${publisher.content.website.url}</a
                  ></span
                >
              `
            : html`<span>(no website)</span>`}
        </div>
      </sl-dialog>

      <div class="row" style="align-items: center;">
        <img
          alt="${publisher.content.name}"
          .src=${publisher.content.icon_src}
          style="width: 35px; height: 35px; border-radius: 50%; margin-left: 5px;"
        />
        <div style="margin-left:5px">${publisher.content.name}</div>
        <sl-icon
          tabindex="0"
          class="info-btn"
          style="font-size: 20px; margin-left: 5px;"
          .src=${wrapPathInSvg(mdiInformationVariantCircle)}
          @click=${(e) => {
            this.publisherDetailsDialog.show();
            e.stopPropagation();
          }}
          @keypress=${(e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              this.publisherDetailsDialog.show();
              e.stopPropagation();
            }
          }}
        >
        </sl-icon>
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

      .info-btn:hover {
        color: white;
      }
    `,
  ];
}

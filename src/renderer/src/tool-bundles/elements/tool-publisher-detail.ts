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
import { DeveloperCollective, UpdateableEntity } from '../../tools-library/types.js';
import { mdiEmailOutline, mdiWeb } from '@mdi/js';

@localized()
@customElement('tool-publisher-detail')
export class ToolPublisherDetail extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @property(hashProperty('developer-collective-hash'))
  developerCollectiveHash!: ActionHash;

  publisher = new StoreSubscriber(
    this,
    () =>
      this._mossStore.toolsLibraryStore.allDeveloperCollectives.get(this.developerCollectiveHash),
    () => [this.developerCollectiveHash],
  );

  renderPublisher(publisher: UpdateableEntity<DeveloperCollective>) {
    if (!publisher) return html``;

    return html`
      <div class="column">
        <div class="row" style="align-items: center; font-size: 1.1rem;">
          <img
            alt="${publisher.record.entry.name}"
            .src=${publisher.record.entry.icon}
            style="width: 40px; height: 40px; border-radius: 50%;"
          />
          <div style="margin-left: 10px; font-size: 1.2rem;">${publisher.record.entry.name}</div>
        </div>
        <div style="margin-top: 20px; opacity: 0.8;">${publisher.record.entry.description}</div>
        <div class="row" style="align-items: center; margin-top: 20px;">
          <sl-icon
            style="font-size: 1.3rem; margin-right: 2px;"
            .src=${wrapPathInSvg(mdiWeb)}
          ></sl-icon>
          <span style="margin-right: 10px;">${msg('Website')}:</span>
          ${publisher.record.entry.website && publisher.record.entry.website !== ''
            ? html`
                <span
                  ><a href="${publisher.record.entry.website}"
                    >${publisher.record.entry.website}</a
                  ></span
                >
              `
            : html`<span>(no website)</span>`}
        </div>
        <div class="row" style="align-items: center; margin-top: 8px;">
          <sl-icon
            style="font-size: 1.3rem; margin-right: 2px;"
            .src=${wrapPathInSvg(mdiEmailOutline)}
          ></sl-icon>
          <span style="margin-right: 10px;">${msg('Contact')}:</span>
          ${publisher.record.entry.contact && publisher.record.entry.contact !== ''
            ? html` <span>${publisher.record.entry.contact}</span> `
            : html`<span>(no contact information)</span>`}
        </div>
      </div>
    `;
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

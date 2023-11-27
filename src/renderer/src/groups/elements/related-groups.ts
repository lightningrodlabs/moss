import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { localized, msg } from '@lit/localize';
import { consume } from '@lit-labs/context';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { weStyles } from '../../shared-styles.js';

@localized()
@customElement('related-groups')
export class RelatedGroups extends LitElement {
  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

  _relatedGroups = new StoreSubscriber(
    this,
    () => this._groupStore.relatedGroups,
    () => [this._groupStore],
  );

  render() {
    return html`
      <div class="column" style="flex: 1;">
        <div class="row" style="align-items: center">
          <span class="title" style="flex: 1">${msg('Related Groups')}</span>
        </div>
        <sl-divider style="--color: grey"></sl-divider>
        ${this.renderContent()}
      </div>
    `;
  }

  renderContent() {
    switch (this._relatedGroups.value?.status) {
      case 'pending':
        return html`
          <div class="row">
            <sl-skeleton
              effect="pulse"
              style="height: 64px; width: 64px; margin-right: 25px; --border-radius: 50%; --color: var(--sl-color-primary-400);"
            ></sl-skeleton>
            <sl-skeleton
              effect="pulse"
              style="height: 64px; width: 64px; margin-right: 25px; --border-radius: 50%; --color: var(--sl-color-primary-400);"
            ></sl-skeleton>
            <sl-skeleton
              effect="pulse"
              style="height: 64px; width: 64px; margin-right: 25px; --border-radius: 50%; --color: var(--sl-color-primary-400);"
            ></sl-skeleton>
          </div>
        `;
      case 'error':
        return html`
          <display-error
            .headline=${msg('Error fetching the applets installed in this group')}
            .error=${this._relatedGroups.value.error}
          ></display-error>
        `;
      case 'complete':
        if (this._relatedGroups.value.value.length === 0)
          return html`<span>This group has no related groups.</span>`;
        return html`
          <div class="row">
            ${this._relatedGroups.value.value.map(
              (relatedGroup) =>
                html` <div
                  class="column"
                  style="align-items: center; cursor: pointer"
                  @click=${() =>
                    this.dispatchEvent(
                      new CustomEvent('open-group', {
                        bubbles: true,
                        composed: true,
                        detail: {
                          networkSeed: relatedGroup.entry.network_seed,
                        },
                      }),
                    )}
                >
                  <img
                    src="${relatedGroup.entry.group_profile.logo_src}"
                    style="width: 64px; height: 64px; border-radius: 50%; margin-bottom: 8px"
                    alt="${relatedGroup.entry.group_profile.name}"
                  /><span>${relatedGroup.entry.group_profile.name}</span>
                </div>`,
            )}
          </div>
        `;
    }
  }

  static styles = [
    weStyles,
    css`
      .title {
        font-size: 25px;
      }
    `,
  ];
}

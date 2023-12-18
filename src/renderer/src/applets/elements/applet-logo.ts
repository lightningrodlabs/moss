import { completed, pipe, StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { msg } from '@lit/localize';
import { hashProperty } from '@holochain-open-dev/elements';
import { EntryHash } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import { weStoreContext } from '../../context.js';
import { WeStore } from '../../we-store.js';
import { weStyles } from '../../shared-styles.js';

@customElement('applet-logo')
export class AppletLogo extends LitElement {
  @consume({ context: weStoreContext, subscribe: true })
  weStore!: WeStore;

  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  @property()
  selected = false;

  appletLogo = new StoreSubscriber(
    this,
    () =>
      pipe(this.weStore.appletStores.get(this.appletHash), (appletStore) =>
        appletStore ? appletStore.logo : completed(undefined),
      ),
    () => [this.appletHash],
  );

  renderLogo(logo: string | undefined) {
    if (!logo) return html``;

    return html`
      <img
        class="icon ${this.selected ? 'selected' : ''}"
        style="height: var(--size, 64px); width: var(--size, 64px); border-radius: var(--border-radius, 50%)"
        .src=${logo}
        alt="TODO"
      />
    `;
  }

  render() {
    switch (this.appletLogo.value.status) {
      case 'pending':
        return html`<sl-skeleton
          style="height: var(--size, 64px); width: var(--size, 64px); border-radius: var(--border-radius, 50%)"
          effect="pulse"
        ></sl-skeleton> `;
      case 'complete':
        return this.renderLogo(this.appletLogo.value.value);
      case 'error':
        console.error('Failed to fetch applet icon: ', this.appletLogo.value.error);
        return html`<display-error
          tooltip
          .headline=${msg('Error fetching the applet logo')}
          .error=${this.appletLogo.value.error}
        ></display-error>`;
    }
  }

  static styles = [
    weStyles,
    css`
      :host {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      /* .icon:hover {
        box-shadow: 0 0 0px 4px var(--hover-color, var(--sl-color-primary-900));
        background: var(--sl-color-primary-900);
      } */
      .selected {
        box-shadow: 0 0 0px 4px var(--hover-color, var(--sl-color-primary-900));
        background: var(--sl-color-primary-900);
      }
    `,
  ];
}

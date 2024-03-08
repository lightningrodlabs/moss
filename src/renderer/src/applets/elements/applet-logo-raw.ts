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

import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { weStyles } from '../../shared-styles.js';

@customElement('applet-logo-raw')
export class AppletLogo extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  @property()
  selected = false;

  @property()
  notificationCount: number | undefined;

  @property()
  notificationUrgency: 'low' | 'medium' | 'high' | undefined;

  appletLogo = new StoreSubscriber(
    this,
    () =>
      pipe(this.mossStore.appletStores.get(this.appletHash), (appletStore) =>
        appletStore ? appletStore.logo : completed(undefined),
      ),
    () => [this.appletHash],
  );

  renderLogo(logo: string | undefined) {
    if (!logo) return html``;

    return html`
      <div style="position: relative;" class="row">
        <div
          class="row center-content notification-dot
            ${this.notificationUrgency === 'high' ? 'urgent' : ''}
            ${this.notificationUrgency === 'high' &&
          this.notificationCount &&
          this.notificationCount > 9
            ? 'padded'
            : ''}
          "
          style="${!this.notificationUrgency ? 'display: none' : ''}"
        >
          ${this.notificationCount && this.notificationUrgency === 'high'
            ? this.notificationCount
            : undefined}
        </div>
        <img
          class="icon"
          style="height: var(--size, 48px); width: var(--size, 48px); border-radius: var(--border-radius, 20%)"
          .src=${logo}
          alt="TODO"
        />
      </div>
    `;
  }

  render() {
    switch (this.appletLogo.value.status) {
      case 'pending':
        return html`<sl-skeleton
          style="height: var(--size, 48px); width: var(--size, 48px); --border-radius: var(--override-border-radius, 20%)"
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

      .notification-dot {
        position: absolute;
        top: 0;
        right: 0;
        font-weight: bold;
        background: #355dfa;
        border-radius: 10px;
        height: 20px;
        min-width: 20px;
      }

      .urgent {
        background: #fcee2d;
      }

      .padded {
        padding: 0 4px;
      }
    `,
  ];
}

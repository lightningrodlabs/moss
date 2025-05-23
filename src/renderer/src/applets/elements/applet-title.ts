import {
  asyncDeriveStore,
  AsyncReadable,
  joinAsync,
  joinAsyncMap,
  StoreSubscriber,
} from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { msg } from '@lit/localize';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';

import { GroupProfile } from '@theweave/api';
import { DnaHash, EntryHash } from '@holochain/client';
import { hashProperty } from '@holochain-open-dev/elements';
import { mapValues } from '@holochain-open-dev/utils';

import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { mossStyles } from '../../shared-styles.js';
import { AppletStore } from '../applet-store.js';

@customElement('applet-title')
export class AppletTitle extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  @property()
  icon: string | undefined;

  @property({ type: Boolean })
  invert = false;

  _applet = new StoreSubscriber(
    this,
    () =>
      joinAsync([
        this._mossStore.appletStores.get(this.appletHash),
        asyncDeriveStore(this._mossStore.groupsForApplet.get(this.appletHash), (groupsStores) =>
          joinAsyncMap(mapValues(groupsStores, (groupStore) => groupStore.groupProfile)),
        ),
      ]) as AsyncReadable<[AppletStore | undefined, ReadonlyMap<DnaHash, GroupProfile>]>,
    () => [this.appletHash],
  );

  _logo = new StoreSubscriber(
    this,
    () => this._mossStore.appletLogo.get(this.appletHash),
    () => [this.appletHash],
  );

  renderTitle([appletStore, _groupsProfiles]: [
    AppletStore | undefined,
    ReadonlyMap<DnaHash, GroupProfile>,
  ]) {
    if (!appletStore) return html``;

    return html`
      <div class="row" style="align-items: center;" title=${appletStore.applet.custom_name}>
        ${this.invert
          ? html`<span style="font-size: var(--font-size, initial); margin-right: 4px;"
              >${appletStore.applet.custom_name}</span
            >`
          : html``}
        ${this._logo.value.status === 'complete'
          ? html`
              <img
                .src=${this._logo.value.value}
                alt="${appletStore.applet.custom_name}"
                style="height: var(--size, 25px); width: var(--size, 25px); border-radius: var(--border-radius, 20%); display: flex;"
              />
            `
          : html`<sl-skeleton
              style="height: var(--size, 25px); width: var(--size, 25px); --border-radius: var(--border-radius, 20%);"
              effect="pulse"
            ></sl-skeleton>`}
        ${this.invert
          ? html``
          : html`<span style="font-size: var(--font-size, initial); margin-left: 4px;"
              >${appletStore.applet.custom_name}</span
            >`}
      </div>
    `;
  }

  render() {
    switch (this._applet.value.status) {
      case 'pending':
        return html``;
      case 'complete':
        return this.renderTitle(this._applet.value.value);
      case 'error':
        return html`<display-error
          tooltip
          .headline=${msg('Error fetching the information about the applet')}
          .error=${this._applet.value.error}
        ></display-error>`;
    }
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: flex;
      }
    `,
  ];
}

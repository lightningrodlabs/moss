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

import { GroupProfile } from '@theweave/api';
import { DnaHash, EntryHash } from '@holochain/client';
import { hashProperty } from '@holochain-open-dev/elements';
import { mapValues } from '@holochain-open-dev/utils';

import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { weStyles } from '../../shared-styles.js';
import { AppletStore } from '../applet-store.js';

@customElement('applet-title')
export class AppletTitle extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  @property()
  icon: string | undefined;

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

  renderTitle([appletStore, _groupsProfiles]: [
    AppletStore | undefined,
    ReadonlyMap<DnaHash, GroupProfile>,
  ]) {
    if (!appletStore) return html``;

    return html`
      <div class="row" style="align-items: center;" title=${appletStore.applet.custom_name}>
        <img
          .src=${this.icon}
          alt="${appletStore.applet.custom_name}"
          style="height: var(--size, 25px); width: var(--size, 25px); border-radius: var(--border-radius, 20%); display: flex; margin-right: 4px;"
        />
        <span>${appletStore.applet.custom_name}</span>
      </div>
    `;
  }

  render() {
    switch (this._applet.value.status) {
      case 'pending':
        return html``;
      case 'complete':
        const appletStore = this._applet.value.value[0];
        if (appletStore) {
          appletStore.logo.subscribe((v) => {
            if (v.status === 'complete') {
              this.icon = v.value;
            }
          });
        }
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
    weStyles,
    css`
      :host {
        display: flex;
      }
    `,
  ];
}

import { AsyncReadable, joinAsync, StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { msg } from '@lit/localize';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import { ActionHash } from '@holochain/client';
import { hashProperty } from '@holochain-open-dev/elements';

import { WeStore } from '../../we-store.js';
import { weStoreContext } from '../../context.js';
import { weStyles } from '../../shared-styles.js';
import { AppEntry, Entity } from '../../processes/appstore/types.js';

@customElement('applet-bundle-title')
export class AppletBundleTitle extends LitElement {
  @consume({ context: weStoreContext, subscribe: true })
  _weStore!: WeStore;

  @property(hashProperty('applet-bundle-hash'))
  appletBundleHash!: ActionHash;

  appletBundle = new StoreSubscriber(
    this,
    () =>
      joinAsync([
        this._weStore.appletBundlesStore.appletBundles.get(this.appletBundleHash),
        this._weStore.appletBundlesStore.appletBundleLogo.get(this.appletBundleHash),
      ]) as AsyncReadable<[Entity<AppEntry> | undefined, string | undefined]>,
    () => [this.appletBundleHash],
  );

  renderTitle([appletBundle, appletBundleLogo]: [
    Entity<AppEntry> | undefined,
    string | undefined,
  ]) {
    if (!appletBundle) return html``;

    return html` <div class="row">
      <img
        alt="${appletBundle.content.title}"
        .src=${appletBundleLogo}
        style="height: 16px; width: 16px; display: flex; margin-right: 4px"
      />
      <span style="color: rgb(119, 119, 119)">${appletBundle.content.title}</span>
    </div>`;
  }

  render() {
    switch (this.appletBundle.value.status) {
      case 'pending':
        return html``;
      case 'complete':
        return this.renderTitle(this.appletBundle.value.value);
      case 'error':
        return html`<display-error
          tooltip
          .headline=${msg('Error fetching the information about the applet bundle')}
          .error=${this.appletBundle.value.error}
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

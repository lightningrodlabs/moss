import { EntryHash } from '@holochain/client';
import { hashProperty } from '@holochain-open-dev/elements';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { msg } from '@lit/localize';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { Applet } from '@theweave/group-client';
import { mossStyles } from '../../shared-styles.js';

@customElement('applet-name')
export class AppletName extends LitElement {
  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  applet = new StoreSubscriber(
    this,
    () => this.groupStore.applets.get(this.appletHash)!,
    () => [],
  );

  renderName(applet: Applet | undefined) {
    if (!applet) return html``;

    return html`<span>${applet.custom_name}</span>`;
  }

  render() {
    switch (this.applet.value.status) {
      case 'pending':
        return html``;
      case 'complete':
        return this.renderName(this.applet.value.value);
      case 'error':
        return html`<display-error
          tooltip
          .headline=${msg('Error fetching the group profile')}
          .error=${this.applet.value.error}
        ></display-error>`;
    }
  }

  static styles = mossStyles;
}

import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized } from '@lit/localize';

import { sharedStyles } from '@holochain-open-dev/elements';
import { lazyLoad, StoreSubscriber } from '@holochain-open-dev/stores';
import { WeClient, type AppletClients, WeServices } from '@lightningrodlabs/we-applet';
import { getAppletsInfosAndGroupsProfiles, weClientContext } from '@lightningrodlabs/we-elements';
import { consume } from '@lit/context';
import { EntryHash } from '@holochain/client';

@localized()
@customElement('cross-applet-main')
export class CrossAppletMain extends LitElement {
  @property()
  applets!: ReadonlyMap<EntryHash, AppletClients>;

  @consume({ context: weClientContext, subscribe: true })
  weClient!: WeClient | WeServices;

  appletsInfo = new StoreSubscriber(
    this,
    () =>
      lazyLoad(async () =>
        getAppletsInfosAndGroupsProfiles(this.weClient as WeClient, Array.from(this.applets.keys()))
      ),
    () => []
  );

  render() {
    return html``;
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex: 1;
      }
    `,
    sharedStyles,
  ];
}

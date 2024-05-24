import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized } from '@lit/localize';

import { sharedStyles } from '@holochain-open-dev/elements';
import { lazyLoad, StoreSubscriber } from '@holochain-open-dev/stores';
import { WeaveClient, type AppletClients, WeaveServices } from '@lightningrodlabs/we-applet';
import {
  getAppletsInfosAndGroupsProfiles,
  weaveClientContext,
} from '@lightningrodlabs/we-elements';
import { consume } from '@lit/context';
import { EntryHash } from '@holochain/client';

@localized()
@customElement('cross-applet-main')
export class CrossAppletMain extends LitElement {
  @property()
  applets!: ReadonlyMap<EntryHash, AppletClients>;

  @consume({ context: weaveClientContext, subscribe: true })
  weaveClient!: WeaveClient | WeaveServices;

  appletsInfo = new StoreSubscriber(
    this,
    () =>
      lazyLoad(async () =>
        getAppletsInfosAndGroupsProfiles(
          this.weaveClient as WeaveClient,
          Array.from(this.applets.keys())
        )
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

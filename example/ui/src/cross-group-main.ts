import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized } from '@lit/localize';

import { sharedStyles } from '@holochain-open-dev/elements';
import { lazyLoad, StoreSubscriber } from '@holochain-open-dev/stores';
import { WeaveClient, type AppletClients, WeaveServices } from '@theweave/api';
import { getAppletsInfosAndGroupsProfiles, weaveClientContext } from '@theweave/elements';
import { consume } from '@lit/context';
import { EntryHash } from '@holochain/client';

@localized()
@customElement('cross-group-main')
export class CrossGroupMain extends LitElement {
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
    return html`Hello from cross-group-main
      <div>
        <h2>Media Access</h2>
        <button
          @click=${async () => {
            await navigator.mediaDevices.getUserMedia({
              audio: {
                noiseSuppression: true,
                echoCancellation: true,
              },
            });
          }}
        >
          Request Audio Access
        </button>
      </div> `;
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

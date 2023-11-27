import { css, html, LitElement, PropertyValues } from 'lit';
import { consume, provide } from '@lit-labs/context';
import { customElement, property, state } from 'lit/decorators.js';
import { Unsubscriber } from '@holochain-open-dev/stores';
import { PeerStatusStore, peerStatusStoreContext } from '@holochain-open-dev/peer-status';
import { ProfilesStore, profilesStoreContext } from '@holochain-open-dev/profiles';
import { DnaHash } from '@holochain/client';

import { WeStore } from '../../we-store.js';
import { weStoreContext } from '../../context.js';
import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { customViewsStoreContext } from '../../custom-views/context.js';
import { CustomViewsStore } from '../../custom-views/custom-views-store.js';

@customElement('group-context')
export class GroupContext extends LitElement {
  @consume({ context: weStoreContext, subscribe: true })
  @state()
  weStore!: WeStore;

  @property()
  groupDnaHash!: DnaHash;

  @provide({ context: groupStoreContext })
  groupStore!: GroupStore;

  @provide({ context: profilesStoreContext })
  profilesStore!: ProfilesStore;

  @provide({ context: peerStatusStoreContext })
  peerStatusStore!: PeerStatusStore;

  @provide({ context: customViewsStoreContext })
  customViewsStore!: CustomViewsStore;

  unsubscribe: Unsubscriber | undefined;

  updated(changedValues: PropertyValues) {
    super.updated(changedValues);

    if (changedValues.has('groupDnaHash')) {
      if (this.unsubscribe) this.unsubscribe();

      this.unsubscribe = this.weStore.groupStores.subscribe((stores) => {
        if (stores.status === 'complete') {
          const groupStore = stores.value.get(this.groupDnaHash);
          if (groupStore) {
            this.groupStore = groupStore;
            this.profilesStore = groupStore.profilesStore;
            this.peerStatusStore = groupStore.peerStatusStore;
            this.customViewsStore = groupStore.customViewsStore;
          }
        }
      });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.unsubscribe) this.unsubscribe();
  }

  render() {
    return html`<slot></slot>`;
  }

  static styles = css`
    :host {
      display: contents;
    }
  `;
}

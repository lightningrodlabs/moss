import { css, html, LitElement, PropertyValues } from 'lit';
import { consume, provide } from '@lit/context';
import { customElement, property, state } from 'lit/decorators.js';
import { Unsubscriber } from '@holochain-open-dev/stores';
import { ProfilesStore, profilesStoreContext } from '@holochain-open-dev/profiles';
import { DnaHash, encodeHashToBase64 } from '@holochain/client';

import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { customViewsStoreContext } from '../../custom-views/context.js';
import { CustomViewsStore } from '../../custom-views/custom-views-store.js';
import { onlineDebugLog } from '../../utils.js';

@customElement('group-context')
export class GroupContext extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  @state()
  mossStore!: MossStore;

  @property()
  groupDnaHash!: DnaHash;

  @provide({ context: groupStoreContext })
  groupStore!: GroupStore;

  @provide({ context: profilesStoreContext })
  profilesStore!: ProfilesStore;

  @provide({ context: customViewsStoreContext })
  customViewsStore!: CustomViewsStore;

  unsubscribe: Unsubscriber | undefined;

  updated(changedValues: PropertyValues) {
    super.updated(changedValues);

    if (changedValues.has('groupDnaHash')) {
      if (this.unsubscribe) this.unsubscribe();

      const groupHashShort = this.groupDnaHash ? encodeHashToBase64(this.groupDnaHash).slice(0, 8) : '??';

      this.unsubscribe = this.mossStore.groupStores.subscribe((stores) => {
        if (stores.status === 'complete') {
          const groupStore = stores.value.get(this.groupDnaHash);
          if (groupStore) {
            const oldInstance = this.groupStore?._instanceId;
            const newInstance = groupStore._instanceId;
            if (oldInstance !== newInstance) {
              onlineDebugLog(`[OnlineDebug][${groupHashShort}] group-context: GroupStore changed from instance=${oldInstance ?? 'none'} to instance=${newInstance}`);
            }
            this.groupStore = groupStore;
            this.profilesStore = groupStore.profilesStore;
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

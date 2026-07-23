import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { localized } from '@lit/localize';
import { sharedStyles } from '@holochain-open-dev/elements';

import { PeerStatus, ReadonlyPeerStatusStore } from '@theweave/api';
import { AgentPubKey, encodeHashToBase64 } from '@holochain/client';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import '@holochain-open-dev/profiles/dist/elements/agent-avatar.js';
import { ProfilesStore, profilesStoreContext } from '@holochain-open-dev/profiles';
import { consume } from '@lit/context';

@localized()
@customElement('agent-status')
export class AgentStatus extends LitElement {
  @consume({ context: profilesStoreContext, subscribe: true })
  @property()
  profilesStore!: ProfilesStore;

  @property()
  peerStatusStore!: ReadonlyPeerStatusStore;

  @property()
  agent!: AgentPubKey;

  peerStatuses = new StoreSubscriber(
    this,
    () => this.peerStatusStore,
    () => [this.peerStatusStore]
  );

  getMyStatus() {
    const myStatus = this.peerStatuses.value[encodeHashToBase64(this.agent)];
    if (!myStatus) return 'offline';
    const now = Date.now();
    if (now - myStatus.lastSeen > 20000) return 'offline';
    return myStatus.status;
  }

  render() {
    return html`<agent-avatar
      .agentPubKey=${this.agent}
      style="${this.getMyStatus() === 'online' || this.getMyStatus() === 'inactive'
        ? ''
        : 'opacity: 0.4'}"
    ></agent-avatar> `;
  }

  static styles = [sharedStyles];
}

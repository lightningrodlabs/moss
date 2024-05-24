import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { localized } from '@lit/localize';
import { sharedStyles } from '@holochain-open-dev/elements';

import { PeerStatus, ReadonlyPeerStatusStore } from '@lightningrodlabs/we-applet';
import { AgentPubKey } from '@holochain/client';
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

  agentStatus = new StoreSubscriber(
    this,
    () => this.peerStatusStore.agentsStatus.get(this.agent),
    () => [this.peerStatusStore]
  );

  render() {
    return html`<agent-avatar
      .agentPubKey=${this.agent}
      style="${this.agentStatus.value === PeerStatus.Offline ? 'opacity: 0.4' : ''}"
    ></agent-avatar> `;
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

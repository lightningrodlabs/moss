import { AgentPubKey } from '@holochain/client';
import { hashProperty } from '@holochain-open-dev/elements';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { Accountability } from '@theweave/group-client';
import { mossStyles } from '../../shared-styles.js';

@customElement('agent-permission')
export class AgentPermission extends LitElement {
  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  @property(hashProperty('agent'))
  agent!: AgentPubKey;

  accountabilities = new StoreSubscriber(
    this,
    () => this.groupStore.agentAccountabilities.get(this.agent)!,
    () => [this.agent, this.groupStore.agentAccountabilities],
  );

  renderAccountabilities(accs: Accountability[]) {
    console.log('Got accountabilities: ', accs);
    if (accs.length == 0) return html`Member`;
    // Dedup and concat types
    const str = [...new Set(accs.map(a => a.type))].join(',');
    return html`${str}`;
  }

  render() {
    switch (this.accountabilities.value.status) {
      case 'pending':
        return html`loading...`;
      case 'complete':
        return this.renderAccountabilities(this.accountabilities.value.value);
      case 'error':
        console.error('Failed to get agent accountabilities: ', this.accountabilities.value.error);
        return html`ERROR`;
    }
  }

  static styles = mossStyles;
}

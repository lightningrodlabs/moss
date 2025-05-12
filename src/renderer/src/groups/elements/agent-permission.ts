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
import { PermissionType } from '@theweave/group-client';
import { weStyles } from '../../shared-styles.js';

@customElement('agent-permission')
export class AgentPermission extends LitElement {
  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  @property(hashProperty('agent'))
  agent!: AgentPubKey;

  permissionType = new StoreSubscriber(
    this,
    () => this.groupStore.agentPermission.get(this.agent),
    () => [this.agent, this.groupStore.agentPermission],
  );

  renderPermissionType(permissionType: PermissionType) {
    console.log('Got permission type: ', permissionType);
    switch (permissionType.type) {
      case 'Member':
        return html`Member`;
      case 'Progenitor':
        return html`Steward`;
      case 'Steward':
        return html`Steward`;
    }
  }

  render() {
    switch (this.permissionType.value.status) {
      case 'pending':
        return html`loading...`;
      case 'complete':
        return this.renderPermissionType(this.permissionType.value.value);
      case 'error':
        console.error('Failed to get agent permission type: ', this.permissionType.value.error);
        return html`ERROR`;
    }
  }

  static styles = weStyles;
}

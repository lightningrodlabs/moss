import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized } from '@lit/localize';
import { consume } from '@lit/context';
import '@holochain-open-dev/profiles/dist/elements/profiles-context.js';
import '@holochain-open-dev/profiles/dist/elements/my-profile.js';
import '@holochain-open-dev/profiles/dist/elements/profile-detail.js';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { AgentPubKey } from '@holochain/client';
import { PermissionLevel } from '../../types.js';
import { weStyles } from '../../shared-styles.js';

@localized()
@customElement('stewards-settings')
export class StewardsSettings extends LitElement {
  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @state()
  leaving = false;

  allAgentPermissionLevels = new StoreSubscriber(
    this,
    () => this.groupStore.allAgentPermissionLevels,
    () => [this.groupStore],
  );

  validityDuration(level: PermissionLevel) {
    if (level.type === 'Steward' && level.content.permission.expiry) {
      return `expires ${new Date(level.content.permission.expiry / 1000).toISOString()}`;
    }
    if (level.type === 'Member') return '';
    return 'no expiry';
  }

  renderPermissionLevels(levels: Array<[AgentPubKey, PermissionLevel]>) {
    return html`
      ${levels.map(
        ([pubkey, level]) => html`
          <sl-card class="permission">
            <div class="row" style="flex: 1; align-items: center;">
              <profile-detail .agentPubKey=${pubkey}></profile-detail>
              <span style="display: flex; flex: 1;"></span>
              <div class="column">
                <div style="font-weight: bold;">${level.type}</div>
                <div style="opacity: 0.8; font-size: 0.86rem; font-style: italic;">
                  ${this.validityDuration(level)}
                </div>
              </div>
            </div>
          </sl-card>
        `,
      )}
    `;
  }

  renderAllAgentPermissions() {
    switch (this.allAgentPermissionLevels.value.status) {
      case 'pending':
        return html`loading...`;
      case 'error':
        console.error(
          'Failed to get all agent permission levels: ',
          this.allAgentPermissionLevels.value.error,
        );
        return html`Failed to get all agent permission levels:
        ${this.allAgentPermissionLevels.value.error}`;
      case 'complete':
        return html`
          ${this.allAgentPermissionLevels.value.value
            ? this.renderPermissionLevels(this.allAgentPermissionLevels.value.value)
            : html`This group has no Stewards. All members have unrestricted permissions.`}
        `;
    }
  }

  render() {
    return html`
      <div class="column" style="flex: 1; align-items: center;">
        <h2>Group Stewards</h2>
        ${this.renderAllAgentPermissions()}
      </div>
    `;
  }

  static styles = [
    weStyles,
    css`
      .permission {
        width: 700px;
      }
    `,
  ];
}

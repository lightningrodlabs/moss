import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { consume } from '@lit/context';
import '@holochain-open-dev/profiles/dist/elements/profiles-context.js';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { AgentPubKey, decodeHashFromBase64 } from '@holochain/client';
import { PermissionType } from '@theweave/group-client';
import { mossStyles } from '../../shared-styles.js';
import { notify, notifyError } from '@holochain-open-dev/elements';

import '../../elements/reusable/profile-detail.js';

@localized()
@customElement('stewards-settings')
export class StewardsSettings extends LitElement {
  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @state()
  leaving = false;

  @state()
  _expirySelected: boolean = false;

  allAgentPermissionTypes = new StoreSubscriber(
    this,
    () => this.groupStore.allAgentPermissionTypes,
    () => [this.groupStore],
  );

  myPermissionType = new StoreSubscriber(
    this,
    () => this.groupStore.permissionType,
    () => [this.groupStore],
  );

  async firstUpdated() {
    await this.groupStore.permissionType.reload();
  }

  validityDuration(level: PermissionType) {
    if (level.type === 'Steward' && level.content.permission.expiry) {
      return `expires ${new Date(level.content.permission.expiry / 1000).toISOString()}`;
    }
    if (level.type === 'Member') return '';
    return 'no expiry';
  }

  canICreatePermissions(level: PermissionType): boolean {
    if (level.type === 'Progenitor') return true;
    if (level.type === 'Steward' && !level.content.permission.expiry) return true;
    return false;
  }

  updateExpirySelectState() {
    const expiryInput = this.shadowRoot?.getElementById('expiry-checkbox') as HTMLInputElement;
    if (expiryInput && expiryInput.checked) {
      this._expirySelected = true;
    } else {
      this._expirySelected = false;
    }
  }

  async createPermission() {
    console.log('Creating permission...');
    console.log('this._expirySelected', this._expirySelected);
    let usTimestamp;
    if (this._expirySelected) {
      const expiryInput = this.shadowRoot?.getElementById('permission-expiry') as HTMLInputElement;
      if (!expiryInput.value) {
        notifyError('No expiry date selected. Uncheck expiry or select date.');
        return;
      }
      const msTimestamp = new Date(expiryInput.value).getTime();
      if (msTimestamp < Date.now()) {
        notifyError('Expiry must be in the future');
        throw new Error('Expiry must be in the future.');
      }
      usTimestamp = msTimestamp * 1000;
    }
    const pubkeyInput = this.shadowRoot?.getElementById('add-steward-pubkey') as HTMLInputElement;
    let forAgent;
    try {
      forAgent = decodeHashFromBase64(pubkeyInput.value);
      if (forAgent.length !== 39 || !pubkeyInput.value.startsWith('uhCAk')) {
        throw new Error('Invalid public key.');
      }
    } catch (e) {
      console.error(e);
      notifyError('Invalid public key.');
      return;
    }
    console.log('Creating permission with input: ', {
      for_agent: forAgent,
      expiry: usTimestamp ? usTimestamp : undefined,
    });

    try {
      await this.groupStore.groupClient.createStewardPermission({
        for_agent: forAgent,
        expiry: usTimestamp ? usTimestamp : undefined,
      });
    } catch (e) {
      notifyError(`Failed to create permission: ${e}`);
      return;
    }
    pubkeyInput.value = '';
    const expiryCheckedInput = this.shadowRoot?.getElementById(
      'expiry-checkbox',
    ) as HTMLInputElement;
    expiryCheckedInput.checked = false;
    const expiryInput = this.shadowRoot?.getElementById('permission-expiry') as HTMLInputElement;
    expiryInput.value = '';
    this._expirySelected = false;
    await this.groupStore.allAgentPermissionTypes.reload();
    notify('New Steward Added.');
    this.requestUpdate();
  }

  renderAddPermission() {
    switch (this.myPermissionType.value.status) {
      case 'pending':
        return html``;
      case 'error':
        console.error('Failed to get my permission level: ', this.myPermissionType.value.error);
        return html``;
      case 'complete': {
        const permissionType = this.myPermissionType.value.value;
        if (this.canICreatePermissions(permissionType)) {
          return html`
            <h3>${msg('Add Steward:')}</h3>
            <div>Public key:</div>
            <input
              id="add-steward-pubkey"
              placeholder="public key"
              style="width: 600px; height: 20px;"
            />
            <div class="row" style="align-items: center; margin: 5px 0;">
              <input
                type="checkbox"
                id="expiry-checkbox"
                @input=${() => this.updateExpirySelectState()}
              />
              <span style="margin-right: 3px;">${msg('expiry')}:</span>
              <input
                ?disabled=${!this._expirySelected}
                type="date"
                id="permission-expiry"
                placeholder="expiry"
              />
            </div>
            <button
              @click=${async () => await this.createPermission()}
              style="margin-bottom: 50px;"
            >
              Add Steward
            </button>
          `;
        }
        return html``;
      }
    }
  }

  renderPermissionTypes(levels: Array<[AgentPubKey, PermissionType]>) {
    return html`
      ${levels.map(
        ([pubkey, level]) => html`
          <sl-card class="permission">
            <div class="row" style="flex: 1; align-items: center;">
              <profile-detail-moss
                no-additional-fields
                .agentPubKey=${pubkey}
              ></profile-detail-moss>
              <span style="display: flex; flex: 1;"></span>
              <div class="column" style="align-items: flex-end;">
                <div style="font-weight: bold;">
                  ${level.type === 'Progenitor' ? 'Steward (Progenitor)' : level.type}
                </div>
                <div style="opacity: 0.8; font-size: 0.86rem; font-style: italic;">
                  ${this.validityDuration(level)}
                </div>
              </div>
            </div>
          </sl-card>
        `,
      )}
      ${this.renderAddPermission()}
    `;
  }

  renderAllAgentPermissions() {
    switch (this.allAgentPermissionTypes.value.status) {
      case 'pending':
        return html`loading...`;
      case 'error':
        console.error(
          'Failed to get all agent permission levels: ',
          this.allAgentPermissionTypes.value.error,
        );
        return html`Failed to get all agent permission levels:
        ${this.allAgentPermissionTypes.value.error}`;
      case 'complete':
        return html`
          ${this.allAgentPermissionTypes.value.value
            ? this.renderPermissionTypes(this.allAgentPermissionTypes.value.value)
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
    mossStyles,
    css`
      .permission {
        width: 700px;
        margin-bottom: 10px;
      }
    `,
  ];
}

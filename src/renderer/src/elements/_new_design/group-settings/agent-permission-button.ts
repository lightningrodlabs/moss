import { AgentPubKey } from '@holochain/client';
import { hashProperty } from '@holochain-open-dev/elements';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import { PermissionType } from '@theweave/group-client';
import { localized, msg } from '@lit/localize';
import { groupStoreContext } from '../../../groups/context.js';
import { GroupStore } from '../../../groups/group-store.js';
import { weStyles } from '../../../shared-styles.js';
import { pencilIcon } from '../../../icons/icons.js';

/**
 * An element that displays the expiry date of a Steward permission or
 * a button to make the person Steward if they have no steward permission
 */
@localized()
@customElement('agent-permission-button')
export class AgentPermissionButton extends LitElement {
  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  @property(hashProperty('agent'))
  agent!: AgentPubKey;

  @state()
  assignRole = false;

  @property({ type: 'Boolean', attribute: 'no-steward' })
  noSteward = false;

  permissionType = new StoreSubscriber(
    this,
    () => this.groupStore.agentPermission.get(this.agent),
    () => [this.agent, this.groupStore.agentPermission],
  );

  myPermissionType = new StoreSubscriber(
    this,
    () => this.groupStore.permissionType,
    () => [this.groupStore],
  );

  canIAddStewards() {
    if (this.myPermissionType.value.status === 'complete') {
      if (this.myPermissionType.value.value.type === 'Progenitor') return true;
      if (
        this.myPermissionType.value.value.type === 'Steward' &&
        !this.myPermissionType.value.value.content.permission.expiry
      )
        return true;
    }
    return false;
  }

  renderPermissionType(permissionType: PermissionType) {
    console.log('Got permission type: ', permissionType);
    switch (permissionType.type) {
      case 'Member':
        return this.canIAddStewards() && !this.noSteward
          ? html`<button
              class="green-btn"
              @click=${() => {
                this.dispatchEvent(new CustomEvent('request-assign-steward', { composed: true }));
              }}
            >
              ${msg('assign steward role')}
            </button>`
          : html``;
      case 'Progenitor':
        return html`<div class="hint">${msg('no expiry')}</div>`;
      case 'Steward':
        return html`<div
          class="hint"
          title="${permissionType.content.permission.expiry
            ? new Date(permissionType.content.permission.expiry / 1000).toLocaleString()
            : undefined}"
        >
          ${permissionType.content.permission.expiry
            ? html`<div class="row items-center">
                <div>
                  until
                  ${new Date(permissionType.content.permission.expiry / 1000).toLocaleDateString()}
                </div>
                <sl-tooltip content="${msg('Extend Role')}">
                <button
                  class="pencil-button"
                  style="margin-left: 4px;"
                  @click=${() => {
                    this.dispatchEvent(
                      new CustomEvent('request-assign-steward', { composed: true }),
                    );
                  }}
                >
                  ${pencilIcon()}
                </button>
                <sl-tooltip>
              </div>`
            : msg('no expiry')}
        </div>`;
    }
  }

  renderContent() {
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

  render() {
    return html`<div class="container column center-content">${this.renderContent()}</div>`;
  }

  static styles = [
    weStyles,
    css`
      .container {
        width: 200px;
      }

      .green-btn {
        all: unset;
        cursor: pointer;
        background: var(--moss-main-green);
        color: var(--moss-hint-green);
        border-radius: 4px;
        padding: 5px 15px;
      }

      .green-btn:focus-visible {
        outline: 2px solid var(--moss-gray-green);
      }

      .hint {
        color: var(--moss-hint-green);
      }

      .pencil-button {
        all: unset;
        color: gray;
        border-radius: 5px;
        cursor: pointer;
      }

      .pencil-button:hover {
        color: black;
      }

      .pencil-button:focus-visible {
        outline: 1px solid orange;
      }
    `,
  ];
}

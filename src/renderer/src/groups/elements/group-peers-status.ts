import { hashProperty } from '@holochain-open-dev/elements';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { AgentPubKey, DnaHash } from '@holochain/client';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '@holochain-open-dev/peer-status/dist/elements/list-agents-by-status.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';

import { groupStoreContext } from '../context.js';
import { weStyles } from '../../shared-styles.js';
import { GroupStore } from '../group-store.js';

@localized()
@customElement('group-peers-status')
export class GroupPeersStatus extends LitElement {
  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

  @property(hashProperty('group-dna-hash'))
  groupDnaHash!: DnaHash;

  _group = new StoreSubscriber(
    this,
    () => this._groupStore?.members,
    () => [this._groupStore, this.groupDnaHash],
  );

  renderPeersStatus(members: AgentPubKey[]) {
    return html`
      <list-agents-by-status
        class="agents-list"
        .agents=${members.filter(
          (m) => m.toString() !== this._groupStore.groupClient.appClient.myPubKey.toString(),
        )}
      ></list-agents-by-status>
    `;
  }

  render() {
    switch (this._group.value?.status) {
      case 'pending':
        return html`<div class="row center-content" style="flex: 1;">
          <sl-spinner style="font-size: 2rem"></sl-spinner>
        </div>`;
      case 'complete':
        return this.renderPeersStatus(this._group.value.value);
      case 'error':
        return html`<display-error
          .headline=${msg('Error displaying the peers of the group')}
          .error=${this._group.value.error}
        ></display-error>`;
    }
  }

  static styles = [
    weStyles,
    css`
      .agents-list {
        color: #fff;
      }

      .agents-list span {
        color: white;
      }
    `,
  ];
}

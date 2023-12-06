import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { msg } from '@lit/localize';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { weStyles } from '../../shared-styles.js';

@customElement('group-title')
export class GroupTitle extends LitElement {
  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  groupProfile = new StoreSubscriber(
    this,
    () => this.groupStore?.groupProfile,
    () => [this.groupStore],
  );

  render() {
    if (!this.groupProfile.value) return html``;

    switch (this.groupProfile.value.status) {
      case 'pending':
        return html`<span>${msg('loading...')}</span>`;
      case 'complete':
        return html`<span
          style="font-size=10px; color: black;"
          title=${this.groupProfile.value.value?.name}
          >${this.groupProfile.value.value?.name}</span
        >`;
      case 'error':
        return html`<span>${msg('unknown...')}</span>`;
    }
  }

  static styles = [
    weStyles,
    css`
      :host {
        display: flex;
        align-items: center;
      }
    `,
  ];
}

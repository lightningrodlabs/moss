import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { msg } from '@lit/localize';
import { GroupProfile } from '@lightningrodlabs/we-applet';
import { DnaHash, encodeHashToBase64 } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { weStyles } from '../../shared-styles.js';

@customElement('group-logo')
export class GroupLogo extends LitElement {
  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  @property()
  groupDnaHash!: DnaHash;

  groupProfile = new StoreSubscriber(
    this,
    () => this.groupStore?.groupProfile,
    () => [this.groupStore],
  );

  renderLogo(groupProfile: GroupProfile | undefined) {
    if (!groupProfile) return html``;

    return html`
      <img
        .src=${groupProfile.logo_src}
        alt="${groupProfile.name}"
        title="${groupProfile.name}"
        style="border-radius: 50%"
      />
    `;
  }

  render() {
    if (!this.groupProfile.value)
      return html`
        <div
          class="column center-content"
          style="border-radius: 50%; height: 40px; width: 40px; background: #d1d1d1; font-weight: bold;"
          title="Unknown Group
(DNA hash: '${encodeHashToBase64(this.groupDnaHash)}')"
        >
          ?
        </div>
      `;

    switch (this.groupProfile.value.status) {
      case 'pending':
        return html`<div class="row center-content" style="flex: 1">
          <sl-spinner style="font-size: 16px"></sl-spinner>
        </div>`;
      case 'complete':
        return this.renderLogo(this.groupProfile.value.value);
      case 'error':
        return html`<display-error
          tooltip
          .headline=${msg('Error fetching the group profile')}
          .error=${this.groupProfile.value.error}
        ></display-error>`;
    }
  }

  static styles = [
    weStyles,
    css`
      :host {
        display: flex;
        align-items: center;
      }
      sl-spinner {
        font-size: var(--size, 16px);
      }
      img {
        width: var(--size, 16px);
        height: var(--size, 16px);
      }
    `,
  ];
}

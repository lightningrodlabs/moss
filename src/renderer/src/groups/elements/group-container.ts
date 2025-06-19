import { localized, msg } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { DnaHash, encodeHashToBase64 } from '@holochain/client';
import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { mossStyles } from '../../shared-styles.js';
import { consume } from '@lit/context';

import '@shoelace-style/shoelace/dist/components/button/button.js';

import './group-home.js';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiPowerPlugOff } from '@mdi/js';

@localized()
@customElement('group-container')
export class GroupContainer extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  groupStore: GroupStore | undefined;

  @property()
  groupDnaHash!: DnaHash;

  async enableGroup() {
    await this.mossStore.enableGroup(this.groupDnaHash);
  }

  renderDisabledGroup() {
    return html` <div class="column center-content" style="flex: 1;">
      <div class="row center-content" style="font-size: 2.5rem; font-weight: bold;">
        <sl-icon style="font-size: 3rem;" .src=${wrapPathInSvg(mdiPowerPlugOff)}></sl-icon>
        <div style="margin-left: 10px;">${msg('This group is disabled.')}</div>
      </div>
      <button
        class="moss-button"
        style="margin-top: 30px;"
        @click=${() => this.enableGroup()}
        variant="success"
      >
        ${msg('Enable')}
      </button>
      <div style="margin-top: 50px;">DNA hash: ${encodeHashToBase64(this.groupDnaHash)}</div>
    </div>`;
  }

  render() {
    if (!this.groupStore) {
      return this.renderDisabledGroup();
    } else {
      return html`<group-home
        class="group-home"
        style="flex: 1; position: relative;"
      ></group-home>`;
    }
  }

  static styles = [
    mossStyles,
    css`
      :host {
      }

      .group-home {
        display: flex;
        padding: 8px;
        background: var(--moss-fishy-green);
        filter: drop-shadow(0px 2px 4px rgba(0, 0, 0, 0.5));
        border-radius: 5px;
      }
    `,
  ];
}

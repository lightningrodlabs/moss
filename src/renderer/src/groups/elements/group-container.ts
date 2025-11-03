import { localized, msg } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { DnaHash, encodeHashToBase64 } from '@holochain/client';
import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { mossStyles } from '../../shared-styles.js';
import { consume } from '@lit/context';

import '@shoelace-style/shoelace/dist/components/button/button.js';

import './applet-main-views.js';
import '../../elements/_new_design/navigation/group-area-sidebar.js';
import './group-home.js';
import '../../elements/_new_design/profile/moss-profile-prompt.js';
import '../../elements/_new_design/group-settings/my-profile-settings.js';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiPowerPlugOff } from '@mdi/js';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { AppletHash } from '@theweave/api';
import { GroupHome } from './group-home.js';
import { MyProfileSettings } from '../../elements/_new_design/group-settings/my-profile-settings.js';
import { MossDialog } from '../../elements/_new_design/moss-dialog.js';
import '../../elements/_new_design/moss-dialog.js';

@localized()
@customElement('group-container')
export class GroupContainer extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  private _mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  private _groupStore: GroupStore | undefined;

  @query('#group-home')
  private _groupHome: GroupHome | undefined;

  @query('#my-profile-dialog')
  private _myProfileDialog: MossDialog | undefined;

  @query('#my-profile-settings')
  private _myProfileSettings: MyProfileSettings | undefined;

  @property()
  groupDnaHash!: DnaHash;

  private _dashboardState = new StoreSubscriber(
    this,
    () => this._mossStore.dashboardState(),
    () => [this._mossStore],
  );

  selectedAppletHash(): AppletHash | undefined {
    if (this._dashboardState.value.viewType === 'group') {
      return this._dashboardState.value.appletHash;
    }
    return undefined;
  }

  async enableGroup() {
    await this._mossStore.enableGroup(this.groupDnaHash);
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
      <div style="margin-top: 50px;">Group ID: ${encodeHashToBase64(this.groupDnaHash)}</div>
    </div>`;
  }

  render() {
    if (!this._groupStore) {
      return this.renderDisabledGroup();
    } else {
      return html`
        <moss-profile-prompt>
          <moss-dialog
            class="gradient"
            width="670px"
            id="my-profile-dialog"
            @sl-hide=${() => {
          this._myProfileSettings?.resetProfile();
        }}
          >
              <span slot="header">${msg('My Profile')}</span>
            <my-profile-settings slot="content" id="my-profile-settings" show-group-profile></my-profile-settings>
          </moss-dialog>
          <div class="row flex-1">
            <group-area-sidebar
              class="flex"
              .selectedAppletHash=${this.selectedAppletHash()}
              @unjoined-tools-clicked=${() => {
          console.log('unjoined tools clicked');

          if (this._groupHome) {
            this._groupHome.openInactiveTools();
            // this.dispatchEvent(
            //   new CustomEvent('group-selected', {
            //     detail: { groupDnaHash: this.groupDnaHash },
            //     composed: true,
            //   }),
            // );

            // this._groupHome.selectTab('unjoined tools');
          }
        }}
              @my-profile-clicked=${() => {
          this._myProfileDialog?.show();
        }}
            ></group-area-sidebar>
            <applet-main-views
              class="flex flex-1"
              style="${this.selectedAppletHash() ? '' : 'display: none;'}"
            ></applet-main-views>
            <group-home
              id="group-home"
              class="group-home"
              style="flex: 1; position: relative; ${this.selectedAppletHash()
          ? 'display: none;'
          : ''}"
            ></group-home>
          </div>
        </moss-profile-prompt>
      `;
    }
  }

  static styles = [
    mossStyles,
    css`
      :host {
      }
      #my-profile-dialog::part(panel) {
        background: linear-gradient(180deg, var(--Moss-main-green, #e0eed5) 18.05%, #f5f5f3 99.92%);
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

import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/radio-group/radio-group.js';
import '@shoelace-style/shoelace/dist/components/radio/radio.js';

import { weStyles } from '../../shared-styles.js';
import './group-settings/general-settings.js';
import './group-settings/tools-settings.js';
import './group-settings/group-member-list.js';
import './group-settings/my-profile-settings.js';
import './group-settings/danger-zone.js';

import { GroupStore } from '../../groups/group-store.js';
import { groupStoreContext } from '../../groups/context.js';
import { consume } from '@lit/context';

enum TabsState {
  General,
  Tools,
  Members,
  MyProfile,
  DangerZone,
}

/**
 * @element create-group-dialog
 */
@localized()
@customElement('group-settings')
export class GroupSettings extends LitElement {
  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  @state()
  tabsState: TabsState = TabsState.General;

  firstUpated() {
    // this._dialog.show();
  }

  renderGeneral() {
    return html`<group-general-settings style="margin-top: 45px;"></group-general-settings>`;
  }

  renderMembers() {
    return html`<group-member-list style="margin-top: 25px;"></group-member-list>`;
  }

  renderTools() {
    return html` <tools-settings></tools-settings> `;
  }

  renderMyProfile() {
    return html` <my-profile-settings></my-profile-settings>`;
  }

  renderDangerZone() {
    return html`<danger-zone></danger-zone>`;
  }

  renderContent() {
    switch (this.tabsState) {
      case TabsState.General:
        return this.renderGeneral();
      case TabsState.Members:
        return this.renderMembers();
      case TabsState.Tools:
        return this.renderTools();
      case TabsState.MyProfile:
        return this.renderMyProfile();
      case TabsState.DangerZone:
        return this.renderDangerZone();
    }
  }

  render() {
    return html`
      <div class="column flex-1" style="padding: 40px 100px;">
        <div class="dialog-title" style="text-align: left; margin-bottom: 20px;">
          ${msg('Space Settings')}
        </div>
        <div class="row items-center tab-bar flex-1">
          <button
            class="tab ${this.tabsState === TabsState.General ? 'selected' : ''}"
            @click=${() => {
              this.tabsState = TabsState.General;
            }}
          >
            ${msg('General')}
          </button>
          <button
            class="tab ${this.tabsState === TabsState.Tools ? 'selected' : ''}"
            @click=${() => {
              this.tabsState = TabsState.Tools;
            }}
          >
            ${msg('Group Tools')}
          </button>
          <button
            class="tab ${this.tabsState === TabsState.Members ? 'selected' : ''}"
            @click=${() => {
              this.tabsState = TabsState.Members;
            }}
          >
            ${msg('Members')}
          </button>
          <button
            class="tab ${this.tabsState === TabsState.MyProfile ? 'selected' : ''}"
            @click=${() => {
              this.tabsState = TabsState.MyProfile;
            }}
          >
            ${msg('My Profile')}
          </button>
          <button
            class="tab ${this.tabsState === TabsState.DangerZone ? 'selected' : ''}"
            @click=${() => {
              this.tabsState = TabsState.DangerZone;
            }}
          >
            ${msg('Danger Zone')}
          </button>
        </div>
        <div class="column" style="margin-top: 10px; min-height: 380px; overflow-y: auto;">
          ${this.renderContent()}
        </div>
      </div>
    `;
  }

  static styles = [
    weStyles,
    css`
      .tab-bar {
        max-width: 784px;
        border-bottom: 2px solid var(--moss-grey-light);
        margin-bottom: -2px;
      }

      .tab {
        all: unset;
        display: flex;
        flex-direction: row;
        align-items: center;
        height: 40px;
        padding: 0 20px;
        cursor: pointer;
        margin-bottom: -2px;
        border-bottom: 2px solid transparent;
      }

      .tab:focus-visible {
        background: var(--moss-purple-semi-transparent);
      }

      .tab:hover {
        color: var(--moss-purple);
        border-bottom: 2px solid var(--moss-purple);
      }

      .selected {
        border-bottom: 2px solid var(--moss-purple);
        color: var(--moss-purple);
      }
    `,
  ];
}

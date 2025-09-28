import { AsyncStatus, StoreSubscriber } from '@holochain-open-dev/stores';
import { customElement, property, query, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { localized, msg } from '@lit/localize';
import { EntryHash } from '@holochain/client';
import { hashState, notify } from '@holochain-open-dev/elements';

import '@holochain-open-dev/elements/dist/elements/display-error.js';

import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';
import { groupStoreContext } from '../../../groups/context.js';
import { GroupStore } from '../../../groups/group-store.js';
import { mossStyles } from '../../../shared-styles.js';
import { MossEditProfile } from '../profile/moss-edit-profile.js';
import { Profile } from '@holochain-open-dev/profiles';
import { EntryRecord } from '@holochain-open-dev/utils';

@localized()
@customElement('my-profile-settings')
export class MyProfileSettings extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

  _myProfile: StoreSubscriber<AsyncStatus<EntryRecord<Profile> | undefined>> = new StoreSubscriber(
    this,
    () => this._groupStore.profilesStore.myProfile,
    () => [this._groupStore],
  );

  private _groupProfile = new StoreSubscriber(
    this,
    () => this._groupStore.groupProfile,
    () => [this._groupStore, this._mossStore],
  );

  @property({ type: Boolean, attribute: 'show-group-profile' })
  showGroupProfile = false;

  @query('#edit-profile')
  editProfileEl: MossEditProfile | undefined;

  @state(hashState())
  appletToUnarchive: EntryHash | undefined;

  @state()
  archiving = false;

  @state()
  unarchiving = false;

  public resetProfile() {
    console.log('Resetting profile 1');
    this.editProfileEl?.resetProfile();
  }

  renderProfile() {
    switch (this._myProfile.value.status) {
      case 'complete':
        return html`<moss-edit-profile
          id="edit-profile"
          .profile=${this._myProfile.value.value ? this._myProfile.value.value.entry : undefined}
          .saveProfileLabel=${msg('Update Profile')}
          @save-profile=${async (e: CustomEvent) => {
            await this._groupStore.profilesStore.client.updateProfile(e.detail.profile);
            this.editProfileEl!.clearLoading();
            notify('Profile updated.');
          }}
        ></moss-edit-profile>`;
      case 'pending':
        return html``;
      case 'error':
        return html``;
    }
  }

  renderGroupProfile() {
    switch (this._groupProfile.value.status) {
      case 'error':
        return html`failed to load group profile.`;
      case 'pending':
        return html`loading...`;
      case 'complete':
        if (!this._groupProfile.value.value) return html`unknown group`;
        return html`
          <div class="row items-center" style="margin: 15px 0 30px 0;">
            <span class="flex flex-1"></span>
            <span style="margin-right: 4px;">${msg('in')}</span>
            <img
              src=${this._groupProfile.value.value.icon_src}
              style="height: 26px; width: 26px;"
            />
            <span style="margin-left: 4px;">${this._groupProfile.value.value.name}</span>
          </div>
        `;
    }
  }

  render() {
    return html`
      <div class="column flex-1">
        ${this.showGroupProfile ? this.renderGroupProfile() : html``} ${this.renderProfile()}
      </div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: flex;
      }
    `,
  ];
}

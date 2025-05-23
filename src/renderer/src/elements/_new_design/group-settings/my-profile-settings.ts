import { StoreSubscriber } from '@holochain-open-dev/stores';
import { customElement, query, state } from 'lit/decorators.js';
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

@localized()
@customElement('my-profile-settings')
export class MyProfileSettings extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

  _myProfile = new StoreSubscriber(
    this,
    () => this._groupStore.profilesStore.myProfile,
    () => [this._groupStore],
  );

  @query('#edit-profile')
  editProfileEl: MossEditProfile | undefined;

  @state(hashState())
  appletToUnarchive: EntryHash | undefined;

  @state()
  archiving = false;

  @state()
  unarchiving = false;

  renderProfile() {
    switch (this._myProfile.value.status) {
      case 'complete':
        console.log('Got profile: ', this._myProfile.value.value);
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

  render() {
    return html`
      <div class="column flex-1" style="margin-top: 40px;">${this.renderProfile()}</div>
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

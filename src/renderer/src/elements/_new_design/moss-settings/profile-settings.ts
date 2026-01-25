import { customElement, query, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { localized, msg } from '@lit/localize';
import { notify } from '@holochain-open-dev/elements';
import { Profile } from '@holochain-open-dev/profiles';

import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';
import { mossStyles } from '../../../shared-styles.js';

import '../profile/moss-edit-profile.js';
import { MossEditProfile } from '../profile/moss-edit-profile.js';

@localized()
@customElement('moss-profile-settings')
export class MossProfileSettings extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @query('#edit-profile')
  editProfileEl: MossEditProfile | undefined;

  @state()
  profile: Profile | undefined;

  firstUpdated() {
    // Load the default profile from persisted store
    const personas = this.mossStore.persistedStore.personas.value();
    if (personas.length > 0) {
      this.profile = personas[0];
    }
  }

  async saveProfile(profile: Profile) {
    // Save to localStorage via persisted store
    this.mossStore.persistedStore.personas.set([profile]);
    this.editProfileEl?.clearLoading();
    notify(msg('Default profile saved.'));
  }

  render() {
    return html`
      <div class="column flex-1 items-center">
        <div style="margin-bottom: 24px; text-align: center; opacity: 0.8;">
          ${msg('This profile will be used as default when joining new groups.')}
        </div>
        <moss-edit-profile
          id="edit-profile"
          .profile=${this.profile}
          .saveProfileLabel=${msg('Save Default Profile')}
          @save-profile=${(e: CustomEvent) => this.saveProfile(e.detail.profile)}
        ></moss-edit-profile>
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

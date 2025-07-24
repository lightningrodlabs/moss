import { css, html, LitElement } from 'lit';
import { property, customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { sharedStyles, notifyError } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import './moss-edit-profile.js';
import { Profile, ProfilesStore, profilesStoreContext } from '@holochain-open-dev/profiles';
import { mossStyles } from '../../../shared-styles.js';
import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';

/**
 * A custom element that fires event on value change.
 *
 * @element create-profile
 * @fires profile-created - Fired after the profile has been created. Detail will have this shape: { profile: { nickname, fields } }
 */
@localized()
@customElement('moss-create-profile')
export class MossCreateProfile extends LitElement {
  /**
   * Profiles store for this element, not required if you embed this element inside a <profiles-context>
   */
  @consume({ context: profilesStoreContext, subscribe: true })
  @property()
  profileStore!: ProfilesStore;

  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @property()
  title = msg('This group will see me as');

  @property()
  buttonLabel = msg('Enter the space');

  @state()
  profile: Profile | undefined;

  firstUpdated() {
    // pre-populate with the profile we used last time
    const personas = this.mossStore.persistedStore.personas.value();
    const defaultPersona = personas[0];
    console.log('defaultPersona: ', defaultPersona);
    if (defaultPersona) {
      this.profile = defaultPersona;
    }
  }

  async createProfile(profile: Profile) {
    try {
      await this.profileStore.client.createProfile(profile);
      // We persist the profile in localStorage as the default profile
      // to pre-populate the profile next time a new profile needs to
      // be created
      this.mossStore.persistedStore.personas.set([profile]);
      this.dispatchEvent(
        new CustomEvent('profile-created', {
          detail: {
            profile,
          },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (e) {
      console.error(e);
      notifyError(msg('Error creating the profile'));
    }
  }

  render() {
    return html`
      <div class="moss-card column">
        <span class="dialog-title" style="margin-top: 50px; margin-bottom: 48px;"
          >${this.title}</span
        >
        <moss-edit-profile
          .saveProfileLabel=${this.buttonLabel}
          .profile=${this.profile}
          @save-profile=${(e: CustomEvent) => this.createProfile(e.detail.profile)}
        ></moss-edit-profile>
      </div>
    `;
  }

  static styles = [
    sharedStyles,
    mossStyles,
    css`
      .moss-card {
        width: 630px;
        height: 466px;
      }
    `,
  ];
}

import { css, html, LitElement } from 'lit';
import { property, customElement, state, query } from 'lit/decorators.js';
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
import { MossEditProfile } from './moss-edit-profile.js';

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

  @state()
  errorMessage: string | undefined;

  @query('moss-edit-profile')
  editProfileComponent!: MossEditProfile;

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
      // Clear any previous error
      this.errorMessage = undefined;

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
      console.error('Error creating profile:', e);

      // Clear the loading state on the button
      if (this.editProfileComponent) {
        this.editProfileComponent.clearLoading();
      }

      // Check if it's a timeout error
      const errorMessage = e instanceof Error ? e.message : String(e);
      if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
        this.errorMessage = msg('Profile creation timed out. Please try again.');
      } else {
        this.errorMessage = msg('There was an error creating your profile. Please try again.');
      }

      notifyError(this.errorMessage);
    }
  }

  render() {
    return html`
      <div class="moss-card column">
        <span class="dialog-title" style="margin-top: 50px; margin-bottom: ${this.errorMessage ? '24px' : '48px'};"
          >${this.title}</span
        >

        ${this.errorMessage
          ? html`
              <div class="error-message" style="background-color: #fee; border: 2px solid #c33; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; width: 350px; color: #c33;">
                <div style="font-weight: 600; margin-bottom: 4px;">${msg('Error')}</div>
                <div style="font-size: 14px;">${this.errorMessage}</div>
              </div>
            `
          : html``}

        <moss-edit-profile
          .saveProfileLabel=${this.errorMessage ? msg('Retry') : this.buttonLabel}
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
        min-height: 466px;
        height: auto;
      }

      .error-message {
        align-self: center;
      }
    `,
  ];
}

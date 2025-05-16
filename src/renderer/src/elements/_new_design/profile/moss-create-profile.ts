import { css, html, LitElement } from 'lit';
import { property, customElement } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { sharedStyles, notifyError } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import './moss-edit-profile.js';
import { Profile, ProfilesStore, profilesStoreContext } from '@holochain-open-dev/profiles';
import { weStyles } from '../../../shared-styles.js';
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
  store!: ProfilesStore;

  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @property()
  title = msg('This group will see me as');

  @property()
  buttonLabel = msg('Enter the space');

  /** Private properties */

  async createProfile(profile: Profile) {
    try {
      await this.store.client.createProfile(profile);
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
          @save-profile=${(e: CustomEvent) => this.createProfile(e.detail.profile)}
        ></moss-edit-profile>
      </div>
    `;
  }

  static styles = [
    sharedStyles,
    weStyles,
    css`
      .moss-card {
        width: 630px;
        height: 466px;
      }
    `,
  ];
}

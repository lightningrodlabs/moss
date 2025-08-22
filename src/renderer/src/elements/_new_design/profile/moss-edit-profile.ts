import { html, LitElement, PropertyValueMap } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { localized, msg, str } from '@lit/localize';
import { consume } from '@lit/context';
import { sharedStyles } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/avatar/avatar.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@holochain-open-dev/elements/dist/elements/select-avatar.js';
import { Profile, ProfilesStore, profilesStoreContext } from '@holochain-open-dev/profiles';
import { mossStyles } from '../../../shared-styles';

import '../moss-select-avatar';
import SlInput from '@shoelace-style/shoelace/dist/components/input/input.js';
import { MossSelectAvatar } from '../moss-select-avatar';

/**
 * @element edit-profile
 * @fires save-profile - Fired when the save profile button is clicked
 */
@localized()
@customElement('moss-edit-profile')
export class MossEditProfile extends LitElement {
  /**
   * The profile to be edited.
   */
  @property({ type: Object })
  profile: Profile | undefined;

  /**
   * Label for the save profile button.
   */
  @property({ type: String, attribute: 'save-profile-label' })
  saveProfileLabel: string | undefined;

  /**
   * Profiles store for this element, not required if you embed this element inside a <profiles-context>
   */
  @consume({ context: profilesStoreContext, subscribe: true })
  @property()
  store!: ProfilesStore;

  @property({ type: Boolean, attribute: 'allow-cancel' })
  allowCancel = false;

  @query('#nickname-input')
  private _nicknameInput!: SlInput;

  @query('#moss-select-avatar')
  private _selectAvatar!: MossSelectAvatar;

  @state()
  nickname: string | undefined;

  @state()
  avatar: string | undefined;

  @state()
  creatingProfile = false;

  @state()
  disabled = true;

  /**
   * This is to be called by a parent element if the profile had
   * successfully been created. It will remove the loading indicator
   * on the button and sync the avatar and nickname component
   * states with the states of the actual profile.
   */
  clearLoading() {
    this.creatingProfile = false;
    if (this.profile) {
      this.nickname = this.profile.nickname;
      this.avatar = this.profile.fields.avatar;
    }
    this.checkDisabled();
  }

  public resetProfile() {
    console.log('Resetting profile 2. Profile: ', this.profile);
    if (this.profile) {
      this.nickname = this.profile.nickname;
      this._nicknameInput.value = this.nickname;
      this.avatar = this.profile.fields.avatar;
      this._selectAvatar.value = this.avatar;
    }
  }

  firstUpdated() {
    if (this.profile) {
      this.nickname = this.profile.nickname;
      this.avatar = this.profile.fields.avatar;
    }
  }

  async willUpdate(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>) {
    if (changedProperties.has('profile')) {
      if (this.profile) {
        this.checkDisabled(); // We want to enable the button now if the profile had been set in the parent component
        this.nickname = this.profile.nickname;
        this.avatar = this.profile.fields.avatar;
      }
    }
  }

  checkDisabled() {
    // profile nickname the same or not and icon the same or not
    const avatarEqual = this.profile?.fields['avatar'] === this.avatar;
    const nicknameEqual = this.profile?.nickname === this.nickname;
    if (!avatarEqual || !nicknameEqual) {
      this.disabled = false;
    } else {
      this.disabled = true;
    }
  }

  emitSaveProfile() {
    const nickname = this.nickname;
    if (!nickname) throw new Error('nickname not defined.');
    const fields: Record<string, string> = this.avatar
      ? {
          avatar: this.avatar,
        }
      : {};

    const profile: Profile = {
      fields,
      nickname,
    };

    this.creatingProfile = true;

    this.dispatchEvent(
      new CustomEvent('save-profile', {
        detail: {
          profile,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  emitCancel() {
    this.dispatchEvent(
      new CustomEvent('cancel-edit-profile', {
        bubbles: true,
        composed: true,
      }),
    );
    this.creatingProfile = false;
  }

  render() {
    return html`
      <div id="profile-form" class="column items-center">
        <sl-input
          id="nickname-input"
          name="nickname"
          class="moss-input"
          label=${msg('name*')}
          placeholder=${'name or nickname'}
          minLength="${this.store.config.minNicknameLength}"
          .value=${this.profile?.nickname || ''}
          .helpText=${msg(str`Min. ${this.store.config.minNicknameLength} characters`)}
          style="width: 350px; margin-bottom: 10px;"
          @input=${(e) => {
            this.nickname = e.target.value;
            this.checkDisabled();
          }}
        ></sl-input>

        <moss-select-avatar
          id="moss-select-avatar"
          name="avatar"
          style="margin-bottom: 46px;"
          .value=${this.profile?.fields['avatar'] || undefined}
          @avatar-selected=${(e) => {
            this.avatar = e.detail.avatar;
            this.checkDisabled();
          }}
          .resetOnClick=${true}
        ></moss-select-avatar>

        <div class="row" style="margin-top: 8px;">
          ${this.allowCancel
            ? html`
                <sl-button style="flex: 1; margin-right: 6px;" @click=${() => this.emitCancel()}>
                  ${msg('Cancel')}
                </sl-button>
              `
            : html``}

          <button
            class="moss-button"
            style="width: 310px; margin-bottom: 56px;"
            variant="primary"
            @click=${() => this.emitSaveProfile()}
            ?disabled=${this.disabled}
          >
            ${this.creatingProfile
              ? html`<div class="column center-content">
                  <div class="dot-carousel" style="margin: 5px 0;"></div>
                </div>`
              : html`${this.saveProfileLabel ?? msg('Save Profile')}`}
          </button>
        </div>
      </div>
    `;
  }

  static styles = [sharedStyles, mossStyles];
}

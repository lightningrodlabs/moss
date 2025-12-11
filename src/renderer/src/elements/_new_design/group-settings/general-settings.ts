import { css, html, LitElement } from 'lit';
import { state, query, customElement } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { notifyError, onSubmit } from '@holochain-open-dev/elements';

import '@holochain-open-dev/elements/dist/elements/select-avatar.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import { mossStyles } from '../../../shared-styles.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';
import { GroupStore } from '../../../groups/group-store.js';
import { groupStoreContext } from '../../../groups/context.js';

import '../moss-select-avatar.js';
import '../copy-hash.js';
import { MossSelectAvatar } from '../moss-select-avatar.js';
import SlInput from '@shoelace-style/shoelace/dist/components/input/input.js';
import { encodeHashToBase64 } from '@holochain/client';

/**
 * @element create-group-dialog
 */
@localized()
@customElement('group-general-settings')
export class GroupGeneralSettings extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

  groupProfile = new StoreSubscriber(
    this,
    () => this._groupStore.groupProfile,
    () => [this._groupStore],
  );

  myAccountabilities = new StoreSubscriber(
    this,
    () => this._groupStore.myAccountabilities,
    () => [this._groupStore],
  );

  @query('form')
  form!: HTMLFormElement;

  @state()
  committing = false;

  @state()
  saveable = false;

  amIPrivileged() {
    if (this.myAccountabilities.value.status !== 'complete') {
      return false;
    }
    for (const acc of this.myAccountabilities.value.value) {
      if (acc.type === 'Steward' || acc.type == 'Progenitor') {
        return true;
      }
    }
    return false;
  }

  discardChanges() {
    const selectGroupAvatar = this.shadowRoot!.getElementById('select-group-avatar') as
      | MossSelectAvatar
      | null
      | undefined;

    if (selectGroupAvatar) selectGroupAvatar.reset();

    const groupNameInput = this.shadowRoot!.getElementById('group-name-input') as
      | SlInput
      | null
      | undefined;

    if (
      groupNameInput &&
      this.groupProfile.value.status === 'complete' &&
      this.groupProfile.value.value?.name
    )
      groupNameInput.value = this.groupProfile.value.value.name;

    this.isSaveable();
  }

  isSaveable() {
    const selectGroupAvatar = this.shadowRoot!.getElementById('select-group-avatar') as
      | MossSelectAvatar
      | null
      | undefined;

    const avatarChanged = selectGroupAvatar
      ? this.groupProfile.value.status === 'complete' &&
        this.groupProfile.value.value?.icon_src !== selectGroupAvatar.value
      : undefined;
    const groupNameInput = this.shadowRoot!.getElementById('group-name-input') as
      | SlInput
      | null
      | undefined;
    const nameChanged = groupNameInput
      ? this.groupProfile.value.status === 'complete' &&
        this.groupProfile.value.value?.name !== groupNameInput.value
      : undefined;

    this.saveable = !!avatarChanged || !!nameChanged;
  }

  private async updateProfile(fields: { icon_src: string; name: string }) {
    if (this.groupProfile.value.status === 'complete') {
      if (
        fields.icon_src === this.groupProfile.value.value?.icon_src &&
        fields.name === this.groupProfile.value.value.name
      )
        return;
    }
    try {
      this.committing = true;
      await this._groupStore.groupClient.setGroupProfile({
        name: fields.name,
        icon_src: fields.icon_src,
      });
    } catch (e) {
      this.committing = false;
      console.error('Failed to update group profile: ', e);
      notifyError(msg('Failed to udpate group profile.'));
    }
    this.committing = false;
    await this._mossStore.reloadManualStores();
  }

  render() {
    switch (this.groupProfile.value.status) {
      case 'pending':
        return html`loading...`;
      case 'error':
        console.error('Error fetching the profile: ', this.groupProfile.value.error);
        return html`Error fetching the profile.`;
      case 'complete':
        return html`
          <form ${onSubmit((f) => this.updateProfile(f))}>
            <div class="column items-center">
              <div class="row items-center">
                ${this.amIPrivileged()
                  ? html` <moss-select-avatar
                      id="select-group-avatar"
                      .value=${this.groupProfile.value.value?.icon_src}
                      .defaultValue=${this.groupProfile.value.value?.icon_src}
                      .label=${msg('Change Group Icon')}
                      shape="rounded"
                      required
                      name="icon_src"
                      @avatar-selected=${() => this.isSaveable()}
                    ></moss-select-avatar>`
                  : html`<img
                      src=${this.groupProfile.value.value?.icon_src}
                      style="height: 80px; width: 80px; border-radius: 12px; opacity: 0.6; cursor: not-allowed;"
                    />`}
                <div class="row">
                  <div class=""></div>
                  <sl-input
                    name="name"
                    id="group-name-input"
                    class="moss-input"
                    style="margin-left: 16px; width: 342px;"
                    .label=${msg('Group name')}
                    required
                    .defaultValue=${this.groupProfile.value.value?.name}
                    .value=${this.groupProfile.value.value?.name}
                    @input=${() => this.isSaveable()}
                    ?disabled=${!this.amIPrivileged()}
                  ></sl-input>
                </div>
              </div>
              ${this.amIPrivileged()
                ? html``
                : html`<div style="font-size: 12px; opacity: 0.6; margin-top: 4px;">
                    ${msg('Only stewards can change the group profile.')}
                  </div>`}

              <div style="margin-top: 28px; margin-bottom: 4px;">${msg('Group ID')}:</div>
              <div class="row">
                <copy-hash .hash=${encodeHashToBase64(this._groupStore.groupDnaHash)}></copy-hash>
              </div>
              <div style="font-size: 12px; opacity: 0.6; margin: 4px 0 28px 4px;">
                ${msg('Unique identifier of this group.')}
              </div>

              ${this.amIPrivileged()
                ? html`<div class="row items-center">
                    <button
                      type="button"
                      class="moss-button-secondary"
                      ?disabled=${!this.saveable}
                      style="margin-right: 8px; margin-left: 2px;"
                      @click=${() => this.discardChanges()}
                    >
                      ${msg('Discard Changes')}
                    </button>
                    <button
                      class="moss-button"
                      type="submit"
                      ?disabled=${!this.saveable}
                      style="width: 150px;"
                    >
                      ${this.committing
                        ? html`<div class="column center-content">
                            <div class="dot-carousel" style="margin: 5px 0;"></div>
                          </div>`
                        : html`${msg('Save Changes')}`}
                    </button>
                  </div>`
                : html``}
            </div>
          </form>
        `;
    }
  }

  static styles = [
    mossStyles,
    css`
      .ruler {
        height: 1px;
        background: var(--moss-grey-light);
      }
    `,
  ];
}

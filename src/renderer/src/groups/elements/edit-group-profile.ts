import { css, html, LitElement } from 'lit';
import { state, query, customElement } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { notifyError, onSubmit } from '@holochain-open-dev/elements';

import '@holochain-open-dev/elements/dist/elements/select-avatar.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { mossStyles } from '../../shared-styles.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';

/**
 * @element create-group-dialog
 */
@localized()
@customElement('edit-group-profile')
export class EditGroupProfile extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

  groupProfile = new StoreSubscriber(
    this,
    () => this._groupStore.groupProfile,
    () => [this._groupStore],
  );

  @query('form')
  form!: HTMLFormElement;

  @state()
  committing = false;

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
      notifyError(msg('Failed to update group profile.'));
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
          <form class="column" ${onSubmit((f) => this.updateProfile(f))}>
            <div class="row" style="justify-content: center">
              <select-avatar
                .defaultValue=${this.groupProfile.value.value?.icon_src}
                .value=${this.groupProfile.value.value?.icon_src}
                required
                name="icon_src"
              ></select-avatar>

              <sl-input
                name="name"
                style="margin-left: 16px"
                .label=${msg('Group name')}
                required
                .defaultValue=${this.groupProfile.value.value?.name}
                .value=${this.groupProfile.value.value?.name}
              ></sl-input>
            </div>

            <sl-button
              style="margin-top: 24px"
              variant="primary"
              type="submit"
              .loading=${this.committing}
            >
              ${msg('Update')}
            </sl-button>
          </form>
        `;
    }
  }

  static styles = [mossStyles, css``];
}

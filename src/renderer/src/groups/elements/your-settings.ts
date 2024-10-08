import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { notifyError, sharedStyles } from '@holochain-open-dev/elements';
import { consume } from '@lit/context';
import '@holochain-open-dev/profiles/dist/elements/profiles-context.js';
import '@holochain-open-dev/profiles/dist/elements/my-profile.js';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { dialogMessagebox } from '../../electron-api.js';

@localized()
@customElement('your-settings')
export class YourSettings extends LitElement {
  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @state()
  leaving = false;

  async leaveGroup() {
    const confirmation = await dialogMessagebox({
      message:
        'WARNING: Leaving a group will refresh Moss. Save any unsaved content in Tools of other groups before you proceed.',
      type: 'warning',
      buttons: ['Cancel', 'Continue'],
    });
    if (confirmation.response === 0) return;
    this.leaving = true;

    const groupDnaHash = this.groupStore.groupDnaHash;
    try {
      await this.mossStore.leaveGroup(groupDnaHash);
      window.location.reload();
    } catch (e) {
      notifyError(msg('Error leaving the group'));
      console.error(e);
    }

    this.leaving = false;
  }

  get dialog(): SlDialog {
    return this.shadowRoot?.getElementById('leave-group-dialog') as SlDialog;
  }

  renderLeaveGroupDialog() {
    return html`<sl-dialog
      id="leave-group-dialog"
      .label=${msg('Leave Group')}
      @sl-request-close=${(e) => {
        if (this.leaving) {
          e.preventDefault();
        }
      }}
    >
      <div class="column">
        <div>${msg('Are you sure you want to leave this group?')}</div>
        <br />
        <div>
          <b>${msg('⚠️ This will delete all your Tools of this group and the data therein')}</b>
          ${msg(' (unless a Tool is shared with another group of yours).')}
        </div>
      </div>
      <sl-button slot="footer" @click=${() => this.dialog.hide()}>${msg('Cancel')}</sl-button>
      <sl-button
        slot="footer"
        variant="danger"
        .loading=${this.leaving}
        @click=${() => this.leaveGroup()}
        >${msg('Leave')}</sl-button
      >
    </sl-dialog>`;
  }

  render() {
    return html`
      ${this.renderLeaveGroupDialog()}
      <div class="column" style="flex: 1; align-items: center;">
        <profiles-context .store=${this.groupStore.profilesStore}>
          <sl-card>
            <span class="title" slot="header">${msg('Your Profile')}</span>
            <my-profile no-additional-fields style="flex: 1"></my-profile
          ></sl-card>
        </profiles-context>
        <div class="row" style="flex: 1; margin-top: 60px;">
          <sl-button variant="danger" @click=${() => this.dialog.show()} style="margin-top: 16px"
            >${msg('Leave Group')}</sl-button
          >
        </div>
      </div>
    `;
  }

  static styles = [sharedStyles];
}

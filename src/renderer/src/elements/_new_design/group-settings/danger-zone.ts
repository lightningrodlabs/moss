import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { localized, msg } from '@lit/localize';
import { notifyError, wrapPathInSvg } from '@holochain-open-dev/elements';

import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';
import { groupStoreContext } from '../../../groups/context.js';
import { GroupStore } from '../../../groups/group-store.js';
import { mossStyles } from '../../../shared-styles.js';
import { closeIcon, doorIcon } from '../icons.js';
import { mdiPowerPlugOffOutline } from '@mdi/js';
import { dialogMessagebox } from '../../../electron-api.js';
import { SlDialog } from '@shoelace-style/shoelace';

@localized()
@customElement('danger-zone')
export class DangerTone extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

  @state()
  leaving = false;

  get dialog(): SlDialog {
    return this.shadowRoot?.getElementById('leave-group-dialog') as SlDialog;
  }

  async leaveGroup() {
    const confirmation = await dialogMessagebox({
      message:
        'WARNING: Leaving a group will refresh Moss. Save any unsaved content in Tools of other groups before you proceed.',
      type: 'warning',
      buttons: ['Cancel', 'Continue'],
    });
    if (confirmation.response === 0) return;
    this.leaving = true;

    const groupDnaHash = this._groupStore.groupDnaHash;
    try {
      await this._mossStore.leaveGroup(groupDnaHash);
      window.location.reload();
    } catch (e) {
      notifyError(msg('Error leaving the group'));
      console.error(e);
    }

    this.leaving = false;
  }

  renderLeaveGroupDialog() {
    return html`<sl-dialog
      id="leave-group-dialog"
      class="moss-dialog"
      no-header
      .label=${msg('Leave Group')}
      @sl-request-close=${(e) => {
        if (this.leaving) {
          e.preventDefault();
        }
      }}
    >
      <div
        class="column center-content dialog-title"
        style="margin: 10px 0 40px 0; position: relative;"
      >
        <span>${msg('Leave Group')}</span>
        <button
          class="moss-dialog-close-button"
          style="position: absolute; top: -23px; right: -12px;"
          @click=${() => {
            this.dialog.hide();
          }}
        >
          ${closeIcon(24)}
        </button>
      </div>
      <div class="column">
        <div>${msg('Are you sure you want to leave this group?')}</div>
        <br />
        <div class="row items-center">
          <div style="margin-right: 10px;">⚠️</div>
          <div>
            <b>${msg('This will delete all your Tools of this group and the data therein')}</b>
          </div>
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
      <div class="column" style="margin-top: 40px;">
        <div class="row items-center" style="margin-bottom: 20px;">
          <button
            class="moss-button"
            style="height: 22px; min-width: 160px;"
            @click=${async () => {
              this.dispatchEvent(
                new CustomEvent('disable-group', {
                  detail: this._groupStore.groupDnaHash,
                  bubbles: true,
                  composed: true,
                }),
              );
            }}
          >
            <div class="row center-content">
              <sl-icon
                style="margin-right: 5px; font-size: 1.3rem;"
                .src=${wrapPathInSvg(mdiPowerPlugOffOutline)}
              ></sl-icon>
              <div>${msg('Disable Group')}</div>
            </div>
          </button>
          <div style="margin-left: 40px;">
            ${msg(
              'Disables this group for yourself and you will stop synchronizing data with other members of this group. You can re-enable it again later.',
            )}
          </div>
        </div>
        <div class="row items-center">
          <button
            class="moss-button center-content"
            style="height: 22px; min-width: 160px; background: #b70000;"
            @click=${() => this.dialog.show()}
          >
            <div class="row center-content">
              <div>${doorIcon(20)}</div>
              <div style="margin-left: 10px;">${msg('Leave Group')}</div>
            </div>
          </button>
          <div style="margin-left: 40px;">
            ${msg(
              'Leave the group forever. You cannot join it again with this instance of Moss and all your data associated to this group and its Tools will be deleted from your computer.',
            )}
          </div>
        </div>
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

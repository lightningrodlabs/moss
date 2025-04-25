import { css, html, LitElement } from 'lit';
import { state, query, customElement } from 'lit/decorators.js';

import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { ProvisionedCell } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/select-avatar.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import SlInput from '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import { notifyError, onSubmit } from '@holochain-open-dev/elements';

import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { weStyles } from '../../shared-styles.js';
import { PartialModifiers } from '@theweave/moss-types';
import { partialModifiersFromInviteLink } from '@theweave/utils';

/**
 * @element join-group-dialog
 */
@localized()
@customElement('join-group-dialog')
export class JoinGroupDialog extends LitElement {
  /** Dependencies */
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  async open(modifiers?: PartialModifiers) {
    if (modifiers) {
      this.modifiers = modifiers;
    } else {
      this._joinByPaste = true;
    }
    this._dialog.show();
  }

  /** Private properties */
  @query('#dialog')
  _dialog!: SlDialog;

  @query('#invite-link-field')
  _inviteLinkField: SlInput | undefined;

  @state()
  modifiers: PartialModifiers | undefined;

  @state()
  _joinByPaste = false;

  @state()
  joining = false;

  private async joinGroup(fields: any) {
    if (this.joining) return;

    let modifiers;

    if (this._joinByPaste && fields.link) {
      try {
        modifiers = partialModifiersFromInviteLink(fields.link);
      } catch (e) {
        notifyError(`Invalid invite link: ${e}`);
        console.error('Error: Failed to join group: Invite link is invalid: ', e);
        return;
      }
    } else {
      modifiers = this.modifiers;
    }

    if (!modifiers) {
      notifyError(msg('Modifiers undefined.'));
      console.error('Error: Failed to join group: Modifiers undefined.');
      return;
    }

    this.joining = true;

    console.log('Joining with modifiers: ', modifiers);

    try {
      const groupAppInfo = await this._mossStore.joinGroup(
        modifiers.networkSeed,
        modifiers.progenitor,
      );

      this.dispatchEvent(
        new CustomEvent('group-joined', {
          detail: {
            groupDnaHash: (groupAppInfo.cell_info['group'][0].value as ProvisionedCell).cell_id[0],
          },
          bubbles: true,
          composed: true,
        }),
      );
      this._dialog.hide();
      this.modifiers = undefined;
      if (this._inviteLinkField) {
        this._inviteLinkField.value = '';
      }
    } catch (e) {
      notifyError(msg('Error joining the group.'));
      console.error(e);
    }
    this.joining = false;
  }

  render() {
    return html`
      <sl-dialog
        id="dialog"
        class="moss-dialog"
        .label=${msg('Join Group')}
        @sl-request-close=${(e) => {
          if (this.joining) {
            e.preventDefault();
          }
        }}
      >
        <form ${onSubmit((f) => this.joinGroup(f))}>
          <div class="column items-center">
          ${
            this._joinByPaste
              ? html`
                  <sl-input
                    name="link"
                    id="invite-link-field"
                    class="moss-input"
                    .label=${msg('Invite Link')}
                    placeholder=${msg('Invite Link')}
                    style="width: 400px;"
                    required
                  ></sl-input>
                `
              : html`<span>${msg('You have been invited to join a group.')}</span>`
          }

          <button
            class="moss-button"
            style="margin-top: 24px; width: 160px;"
            type="submit"
            .loading=${this.joining}
          >
            ${
              this.joining
                ? html`<div class="column center-content">
                    <div class="dot-carousel" style="margin: 5px 0;"></div>
                  </div>`
                : html`${msg('Join Group')}`
            }
          </button>
          <div>
        </form>
      </sl-dialog>
    `;
  }

  static styles = [
    weStyles,
    css`
      sl-dialog {
        --sl-panel-background-color: var(--sl-color-primary-0);
      }
    `,
  ];
}

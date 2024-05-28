import { css, html, LitElement } from 'lit';
import { state, query, property, customElement } from 'lit/decorators.js';

import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { CellType, DnaModifiers } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/select-avatar.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import SlInput from '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import { notifyError, onSubmit } from '@holochain-open-dev/elements';

import { MossStore } from '../moss-store.js';
import { mossStoreContext } from '../context.js';
import { weStyles } from '../shared-styles.js';
import { GroupDnaProperties, PartialModifiers } from '../types.js';
import { partialModifiersFromInviteLink } from '../utils.js';
import { decode } from '@msgpack/msgpack';

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

  @property()
  modifiers: PartialModifiers | undefined;

  @property()
  _joinByPaste = false;

  @state()
  joining = false;

  private async joinGroup(fields: any) {
    if (this.joining) return;

    const modifiers =
      this._joinByPaste && fields.link
        ? partialModifiersFromInviteLink(fields.link)
        : this.modifiers;
    console.log('got fields: ', fields);

    if (!modifiers) {
      notifyError(msg('Invalid invitation link.'));
      console.error('Error: Failed to join group: Invitation link is invalid.');
      return;
    }

    this.joining = true;

    try {
      const groupAppInfo = await this._mossStore.joinGroup(
        modifiers.networkSeed,
        modifiers.progenitor,
      );

      this.dispatchEvent(
        new CustomEvent('group-joined', {
          detail: {
            groupDnaHash: groupAppInfo.cell_info['group'][0][CellType.Provisioned].cell_id[0],
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
        .label=${msg('Join Group')}
        @sl-request-close=${(e) => {
          if (this.joining) {
            e.preventDefault();
          }
        }}
      >
        <div class="column" style="justify-content: center">
          <form ${onSubmit((f) => this.joinGroup(f))}>
            ${this._joinByPaste
              ? html`
                  <sl-input
                    name="link"
                    id="invite-link-field"
                    .label=${msg('Invite Link')}
                    required
                  ></sl-input>
                `
              : html`<span>${msg('You have been invited to join a group.')}</span>`}

            <sl-button
              style="margin-top: 24px"
              variant="primary"
              type="submit"
              .loading=${this.joining}
            >
              ${msg('Join Group')}
            </sl-button>
          </form>
        </div>
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

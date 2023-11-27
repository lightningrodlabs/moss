import { html, LitElement } from 'lit';
import { state, query, property, customElement } from 'lit/decorators.js';

import { consume } from '@lit-labs/context';
import { localized, msg } from '@lit/localize';
import { CellType } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/select-avatar.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import SlInput from '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import { notifyError, onSubmit } from '@holochain-open-dev/elements';

import { WeStore } from '../we-store.js';
import { weStoreContext } from '../context.js';
import { weStyles } from '../shared-styles.js';

/**
 * @element join-group-dialog
 */
@localized()
@customElement('join-group-dialog')
export class JoinGroupDialog extends LitElement {
  /** Dependencies */
  @consume({ context: weStoreContext, subscribe: true })
  _weStore!: WeStore;

  async open(networkSeed?: string) {
    if (networkSeed) {
      this.networkSeed = networkSeed;
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
  networkSeed: string | undefined;

  @property()
  _joinByPaste = false;

  @state()
  joining = false;

  private async joinGroup(fields: any) {
    if (this.joining) return;

    const networkSeed =
      this._joinByPaste && fields.link ? networkSeedFromInviteLink(fields.link) : this.networkSeed;
    console.log('got fields: ', fields);

    if (!networkSeed) {
      notifyError(msg('Invalid invitation link.'));
      console.error('Error: Failed to join group: Invitation link is invalid.');
    }

    this.joining = true;

    try {
      const groupAppInfo = await this._weStore.joinGroup(networkSeed!);

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
      this.networkSeed = undefined;
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

  static styles = [weStyles];
}

function networkSeedFromInviteLink(inviteLink: string): string | undefined {
  const split = inviteLink.split('://');
  const split2 = split[2].split('/');
  console.log('split: ', split);
  console.log('split2: ', split2);
  if (split2[0] === 'group') {
    return split2[1];
  } else {
    return undefined;
  }
}

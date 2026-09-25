import { css, html, LitElement } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { DnaModifiers } from '@holochain/client';
import { GroupProfile } from '@theweave/api';
import { notify } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/input/input.js';
import '../../../ui/moss-dialog.js';
import './local-network-invite.js';

import { modifiersToInviteCode, modifiersToInviteUrl } from '../../../invite-link.js';
import { mossStyles } from '../../../shared-styles.js';
import { MossDialog } from '../../../ui/moss-dialog.js';
import {
  closeInviteDialog,
  initialInviteDialog,
  InviteDialogState,
  InviteTab,
  openInviteDialog,
  selectInviteTab,
  visibleInvitePanes,
} from './invite-dialog-state.js';

@localized()
@customElement('invite-people-dialog')
export class InvitePeopleDialog extends LitElement {
  @property({ type: Object })
  groupProfile!: GroupProfile;

  @property({ type: Object })
  modifiers!: DnaModifiers;

  @query('#invite-member-dialog')
  _dialog!: MossDialog;

  /**
   * Which tab is showing and whether the local-network pane exists. Hiding a
   * moss-dialog leaves its slotted content mounted and connected, so a pane that
   * opens a UDP socket on connection would bind it, and raise the macOS
   * local-network and Windows firewall prompts, the moment a group is entered.
   * The pane is therefore mounted only while the dialog is open and after its
   * tab has been chosen. See invite-dialog-state.ts.
   */
  @state()
  _state: InviteDialogState = initialInviteDialog();

  render() {
    if (!this.groupProfile || !this.modifiers) {
      return html``;
    }

    const invitationUrl = modifiersToInviteUrl(this.modifiers);
    const invitationCode = modifiersToInviteCode(this.modifiers);

    return html`
      <moss-dialog
        id="invite-member-dialog"
        headerAlign="center"
        width="674px"
        @sl-after-hide=${(e: Event) => {
          // Shoelace components inside the dialog body (the pane's duration
          // select, for one) emit this event too; only the dialog's own
          // close, retargeted to the moss-dialog host, ends the session.
          if (e.target !== this._dialog) return;
          const pane = this.shadowRoot?.querySelector('local-network-invite') as {
            listing: boolean;
          } | null;
          if (pane?.listing) notify(msg('This group is no longer listed on the local network.'));
          this._state = closeInviteDialog(this._state);
        }}
      >
        <span slot="header">${msg('Invite People')}</span>
        <div slot="content">
          <div class="row" style="align-items: center; flex: 1; margin-bottom: 22px;">
            <img
              .src=${this.groupProfile.icon_src}
              style="height: 40px; width: 40px; margin-right: 16px; border-radius: 50%;"
              alt="${this.groupProfile.name}"
            />
            <span style="font-size: 18px; font-weight: 500;">${this.groupProfile.name}</span>
          </div>
          <div class="column" style="max-width: 440px;">
            ${this.renderModeSwitch()} ${this.renderLocalNetwork(invitationCode)}
            ${visibleInvitePanes(this._state).inviteCode
              ? this.renderInviteCode(invitationUrl, invitationCode)
              : html``}
          </div>
        </div>
      </moss-dialog>
    `;
  }

  private renderModeSwitch() {
    const tab = (mode: InviteTab, label: string) => html`
      <button
        type="button"
        class="mode ${this._state.tab === mode ? 'selected' : ''}"
        @click=${() => {
          this._state = selectInviteTab(this._state, mode);
        }}
      >
        ${label}
      </button>
    `;
    return html`
      <div class="row mode-switch">
        ${tab('code', msg('Invitation'))}${tab('network', msg('Local Network Scan'))}
      </div>
    `;
  }

  private renderLocalNetwork(invitationCode: string) {
    return html`
      ${visibleInvitePanes(this._state).networkPane
        ? html`<local-network-invite
            style="margin-bottom: 24px;"
            ?hidden=${this._state.tab !== 'network'}
            .inviteCode=${invitationCode}
            .groupName=${this.groupProfile.name}
          ></local-network-invite>`
        : html``}
    `;
  }

  private renderInviteCode(invitationUrl: string, invitationCode: string) {
    return html`
      <span style="opacity: 0.7; font-size: 16px;"
        >${msg('Copy and send the link below to invite people:')}</span
      >
      <div class="row" style="margin-top: 16px; margin-bottom: 24px;">
        <sl-input
          disabled
          value=${invitationUrl}
          class="moss-input copy-link-input"
          style="margin-right: 8px; cursor: pointer; flex: 1;"
          @click=${async () => {
            await navigator.clipboard.writeText(invitationUrl);
            notify(msg('Invite link copied to clipboard.'));
          }}
        >
        </sl-input>
        <button
          variant="primary"
          class="moss-button"
          @click=${async () => {
            await navigator.clipboard.writeText(invitationUrl);
            notify(msg('Invite link copied to clipboard.'));
          }}
        >
          ${msg('Copy')}
        </button>
      </div>

      <span style="opacity: 0.7; font-size: 16px;"
        >${msg(
          'Or send this invite code instead, for places where links get stripped or broken:',
        )}</span
      >
      <div class="row" style="margin-top: 16px; margin-bottom: 24px;">
        <sl-input
          disabled
          value=${invitationCode}
          class="moss-input copy-link-input"
          style="margin-right: 8px; cursor: pointer; flex: 1;"
          @click=${async () => {
            await navigator.clipboard.writeText(invitationCode);
            notify(msg('Invite code copied to clipboard.'));
          }}
        >
        </sl-input>
        <button
          variant="primary"
          class="moss-button"
          @click=${async () => {
            await navigator.clipboard.writeText(invitationCode);
            notify(msg('Invite code copied to clipboard.'));
          }}
        >
          ${msg('Copy')}
        </button>
      </div>

      <div style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">
        ${msg('About invites:')}
      </div>
      <div style="font-size: 12px; opacity: 0.7;">
        ${msg(
          'Currently Moss invites work according to the rule "Here is my home address, the door is open." Everyone with the link or code can join the group, so be careful where you share them.',
        )}
      </div>
    `;
  }

  async show() {
    this._state = openInviteDialog(this._state);
    // moss-dialog documents that racing sl-dialog's animated show() against a
    // Lit re-render of its content can leave it half-mounted, so the pane is
    // in the DOM before the dialog is told to appear.
    await this.updateComplete;
    await this._dialog?.show();
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: contents;
      }
      /* This one sits under a heading rather than centred. */
      .mode-switch {
        align-self: flex-start;
        margin-bottom: 20px;
      }
    `,
  ];
}

import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { DnaModifiers } from '@holochain/client';
import { GroupProfile } from '@theweave/api';
import { notify } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/input/input.js';
import './moss-dialog.js';

import { modifiersToInviteUrl } from '../../utils.js';
import { mossStyles } from '../../shared-styles.js';

@localized()
@customElement('invite-people-dialog')
export class InvitePeopleDialog extends LitElement {
  @property({ type: Object })
  groupProfile!: GroupProfile;

  @property({ type: Object })
  modifiers!: DnaModifiers;

  render() {
    if (!this.groupProfile || !this.modifiers) {
      return html``;
    }

    const invitationUrl = modifiersToInviteUrl(this.modifiers);

    return html`
      <moss-dialog id="invite-member-dialog" headerAlign="center" width="674px">
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
            <span style="opacity: 0.7; font-size: 16px;"
              >${msg('Copy and send the link below to invite people:')}</span
            >
            <div class="row" style="margin-top: 16px; margin-bottom: 60px;">
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

            <div style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">
              ${msg('About invite links:')}
            </div>
            <div style="font-size: 12px; opacity: 0.7;">
              ${msg(
                'Currently Moss invites work according to the rule "Here is my home address, the door is open." Everyone with a link can join the group, so be careful where you share this link.',
              )}
            </div>
          </div>
        </div>
      </moss-dialog>
    `;
  }

  show() {
    const dialog = this.shadowRoot?.getElementById('invite-member-dialog') as any;
    dialog?.show();
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: contents;
      }
    `,
  ];
}

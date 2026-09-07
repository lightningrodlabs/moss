import { css, html, LitElement } from 'lit';
import { state, query, customElement } from 'lit/decorators.js';

import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { ProvisionedCell } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/select-avatar.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import SlInput from '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import { notify, notifyError, onSubmit } from '@holochain-open-dev/elements';
import { toPromise } from '@holochain-open-dev/stores';
import { encodeHashToBase64 } from '@holochain/client';

import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { mossStyles } from '../../shared-styles.js';
import { PartialModifiers } from '@theweave/moss-types';
import { partialModifiersFromInviteString } from '@theweave/utils';
import { inviteErrorMessage } from '../../invite-error.js';
import { MossDialog } from '../../ui/moss-dialog.js';
import '../../ui/moss-dialog.js';
import './local-network-join.js';

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
      this._joinByPaste = false;
    } else {
      this._joinByPaste = true;
      this._mode = 'code';
    }
    this._dialogOpen = true;
    void this.loadJoinedGroupNames();
    // moss-dialog documents that racing sl-dialog's animated show() against a
    // Lit re-render of its content can leave it half-mounted, so the pane is
    // in the DOM before the dialog is told to appear.
    await this.updateComplete;
    this._dialog.show();
  }

  /** Private properties */
  @query('#dialog')
  _dialog!: MossDialog;

  @query('#invite-link-field')
  _inviteLinkField: SlInput | undefined;

  @state()
  modifiers: PartialModifiers | undefined;

  @state()
  _joinByPaste = false;

  /**
   * Whether the local-network pane should exist at all. Hiding a moss-dialog
   * leaves its slotted content mounted and connected, so a pane left rendered
   * would keep the UDP socket bound, keep announcing an intent beacon for the
   * rest of its window, and go on accepting sealed invites behind a shut
   * dialog. Mounting it only while the dialog is genuinely open is what makes
   * the exchange end when the user closes it.
   */
  @state()
  _dialogOpen = false;

  @state()
  joining = false;

  /**
   * Which way of joining is showing. The local-network pane is mounted only in
   * 'network' mode, so this is also what decides whether this computer is
   * listening on the network at all.
   */
  @state()
  _mode: 'code' | 'network' = 'code';

  /**
   * Whether the network pane has been opened during this dialog. It stays
   * mounted afterwards, hidden behind the other tab: an announcement belongs to
   * the dialog, not to whichever tab happens to be in front, and tearing it
   * down on a tab switch stopped the announcement and reset its countdown.
   */
  @state()
  _networkVisited = false;

  /**
   * Names of groups already on this computer, used to mark a likely match in
   * the offered list. The beacon carries no group identity, so this can only
   * ever be a hint.
   */
  @state()
  _joinedGroupNames: string[] = [];

  /** DNA hashes of the groups already on this computer, as base64. */
  private async knownGroupHashes(): Promise<Set<string>> {
    try {
      const stores = await toPromise(this._mossStore.groupStores);
      return new Set(Array.from(stores.keys()).map((hash) => encodeHashToBase64(hash)));
    } catch (e) {
      // Without this we simply do not mention that the group was already here.
      console.warn('Could not read installed groups:', e);
      return new Set();
    }
  }

  private async loadJoinedGroupNames(): Promise<void> {
    try {
      const profiles = await toPromise(this._mossStore.allGroupsProfiles);
      this._joinedGroupNames = Array.from(profiles.values())
        .map((profile) => profile?.name)
        .filter((name): name is string => !!name);
    } catch (e) {
      // A name we cannot resolve only costs the "Joined" hint on one row.
      console.warn('Could not read joined group names:', e);
      this._joinedGroupNames = [];
    }
  }

  private async joinGroup(fields: any) {
    if (this.joining) return;

    let modifiers;

    if (this._joinByPaste && fields.link) {
      try {
        modifiers = partialModifiersFromInviteString(fields.link);
      } catch (e) {
        notifyError(inviteErrorMessage(e));
        console.error('Error: Failed to join group: Invite is invalid: ', e);
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
      // Joining a group already on this computer just re-opens it, which is
      // silently indistinguishable from joining a new one. Knowing which
      // groups were here beforehand is what lets us say so.
      const knownBefore = await this.knownGroupHashes();

      const groupAppInfo = await this._mossStore.joinGroup(
        modifiers.networkSeed,
        modifiers.progenitor,
      );

      const groupDnaHash = (groupAppInfo.cell_info['group'][0].value as ProvisionedCell).cell_id[0];
      if (knownBefore.has(encodeHashToBase64(groupDnaHash))) {
        notify(msg('You are already in this group — opening it.'));
      }

      this.dispatchEvent(
        new CustomEvent('group-joined', {
          detail: { groupDnaHash },
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

  private renderModeSwitch() {
    const tab = (mode: 'network' | 'code', label: string) => html`
      <button
        type="button"
        class="mode ${this._mode === mode ? 'selected' : ''}"
        @click=${() => {
          this._mode = mode;
          if (mode === 'network') this._networkVisited = true;
        }}
      >
        ${label}
      </button>
    `;
    return html`
      <div class="row mode-switch" style="margin-bottom: 20px;">
        ${tab('code', msg('Use Invitation'))}${tab('network', msg('Scan Local Network'))}
      </div>
    `;
  }

  render() {
    return html`
      <moss-dialog
        id="dialog"
        width="670px"
        headerAlign="center"
        @sl-initial-focus=${(e: { preventDefault: () => void }) => {
          e.preventDefault();
          this._inviteLinkField?.focus();
        }}

        @sl-request-close=${(e) => {
          if (this.joining) {
            e.preventDefault();
          }
        }}
        @sl-after-hide=${(e: Event) => {
          // Shoelace components inside the dialog body emit this event too;
          // only the dialog's own close, retargeted to the moss-dialog host,
          // tears the local-network pane down.
          if (e.target !== this._dialog) return;
          const pane = this.shadowRoot?.querySelector('local-network-join') as {
            announcing: boolean;
          } | null;
          if (pane?.announcing)
            notify(msg('You are no longer announcing yourself on this network.'));
          this._dialogOpen = false;
          this._networkVisited = false;
        }}
      >
        <span slot="header">${msg('Join Group')}</span>
        <form slot="content" ${onSubmit((f) => this.joinGroup(f))}>
          <div class="column items-center">
          ${this._joinByPaste ? this.renderModeSwitch() : html``}
          ${
            this._joinByPaste && this._dialogOpen && this._networkVisited
              ? html`<local-network-join
                  style="width: 400px;"
                  ?hidden=${this._mode !== 'network'}
                  .joinedGroupNames=${this._joinedGroupNames}
                  @local-invite-received=${(e: CustomEvent<{ code: string; groupName: string }>) =>
                    this.joinGroup({ link: e.detail.code })}
                ></local-network-join>`
              : html``
          }
          ${
            this._joinByPaste
              ? this._mode === 'network'
                ? html``
                : html`
                    <sl-input
                      name="link"
                      id="invite-link-field"
                      class="moss-input"
                      .label=${msg('Invite Link or Code')}
                      placeholder=${msg('paste invite link or code here')}
                      style="width: 400px;"
                      required
                    ></sl-input>
                  `
              : html`<span>${msg('You have been invited to join a group.')}</span>`
          }

          ${
            this._joinByPaste && this._mode === 'network'
              ? html``
              : html`<button
                  class="moss-button"
                  style="margin-top: 24px; margin-bottom: 20px; width: 160px;"
                  type="submit"
                  .loading=${this.joining}
                >
                  ${this.joining
                    ? html`<div class="column center-content">
                        <div class="dot-carousel" style="margin: 5px 0;"></div>
                      </div>`
                    : html`${msg('Join Group')}`}
                </button>`
          }
          <div>
        </form>
      </moss-dialog>
    `;
  }

  static styles = [mossStyles, css``];
}

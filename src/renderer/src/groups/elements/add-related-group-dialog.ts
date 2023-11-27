import { notifyError, onSubmit } from '@holochain-open-dev/elements';
import { decodeHashFromBase64, DnaHash, encodeHashToBase64 } from '@holochain/client';
import { consume } from '@lit-labs/context';
import { localized, msg, str } from '@lit/localize';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { AsyncReadable, joinAsync, StoreSubscriber } from '@holochain-open-dev/stores';
import { GroupProfile } from '@lightningrodlabs/we-applet';
import { EntryRecord } from '@holochain-open-dev/utils';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';

import { weStoreContext } from '../../context.js';
import { WeStore } from '../../we-store.js';
import { GroupStore } from '../group-store.js';
import { groupStoreContext } from '../context.js';
import { RelatedGroup } from '../types.js';

@localized()
@customElement('add-related-group-dialog')
export class AddRelatedGroupDialog extends LitElement {
  @consume({ context: weStoreContext })
  _weStore!: WeStore;

  @consume({ context: groupStoreContext })
  _groupStore!: GroupStore;

  _groups = new StoreSubscriber(
    this,
    () =>
      joinAsync([this._weStore.allGroupsProfiles, this._groupStore.relatedGroups]) as AsyncReadable<
        [ReadonlyMap<DnaHash, GroupProfile>, Array<EntryRecord<RelatedGroup>>]
      >,
    () => [this._weStore],
  );

  @state()
  committing = false;

  show() {
    (this.shadowRoot?.getElementById('dialog') as SlDialog).show();
    (this.shadowRoot?.getElementById('form') as HTMLFormElement)?.reset();
  }

  async addRelatedGroup(groupDnaHash: DnaHash, groupProfile: GroupProfile) {
    if (this.committing) return;

    this.committing = true;
    try {
      await this._groupStore.addRelatedGroup(groupDnaHash, groupProfile);

      const dialog = this.shadowRoot?.getElementById('dialog') as SlDialog;
      dialog.hide();
    } catch (e) {
      notifyError(msg('Error adding a related group.'));
      console.error(e);
    }

    this.committing = false;
  }

  renderDialogContent() {
    switch (this._groups.value.status) {
      case 'pending':
        return html`<div class="row center-content" style="flex: 1">
          <sl-spinner style="font-size: 2rem"></sl-spinner>
        </div>`;
      case 'complete':
        const relatedGroups = this._groups.value.value[1];
        const groupsProfiles = this._groups.value.value[0];
        const groups = Array.from(groupsProfiles.entries()).filter(
          ([groupDnaHash, _]) =>
            groupDnaHash.toString() !== this._groupStore.groupDnaHash.toString() &&
            !relatedGroups.find(
              (relatedGroup) =>
                relatedGroup.entry.group_dna_hash.toString() === groupDnaHash.toString(),
            ),
        );

        return html`
          <form
            id="form"
            ${onSubmit((f) =>
              this.addRelatedGroup(
                decodeHashFromBase64(f.groupDnaHash),
                groupsProfiles.get(decodeHashFromBase64(f.groupDnaHash))!,
              ),
            )}
          >
            <span
              >${msg(
                str`Adding a related group will share it with all the members of this group (${groupsProfiles.get(
                  this._groupStore.groupDnaHash,
                )?.name}), so all its members can join it.`,
              )}</span
            ><br /><br />
            <span>${msg('Which group do you want to add as related?')}</span>
            <sl-select
              .placeholder=${msg('Select Group')}
              name="groupDnaHash"
              @sl-hide=${(e) => e.stopPropagation()}
              style="margin-top: 16px"
              required
            >
              ${groups.map(
                ([groupDnaHash, groupProfile]) => html`
                  <sl-option .value=${encodeHashToBase64(groupDnaHash)}>
                    <img
                      slot="prefix"
                      .src=${groupProfile?.logo_src}
                      alt="${groupProfile?.name}"
                      style="height: 16px; width: 16px"
                    />${groupProfile?.name}</sl-option
                  >
                `,
              )}
            </sl-select>
          </form>
          <sl-button
            slot="footer"
            @click=${() => {
              (this.shadowRoot?.getElementById('dialog') as SlDialog).hide();
            }}
            >${msg('Cancel')}</sl-button
          >
          <sl-button
            slot="footer"
            .loading=${this.committing}
            variant="primary"
            type="submit"
            form="form"
            >${msg('Add Related Group')}</sl-button
          >
        `;

      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching your groups')}
          .error=${this._groups.value.error}
        ></display-error>`;
    }
  }

  render() {
    return html`<sl-dialog
      id="dialog"
      .label=${msg('Add Related Group')}
      @sl-request-close=${(e) => {
        if (this.committing) {
          e.preventDefault();
        }
      }}
    >
      ${this.renderDialogContent()}
    </sl-dialog>`;
  }
}

import { hashProperty, notify, notifyError, onSubmit } from '@holochain-open-dev/elements';
import { decodeHashFromBase64, DnaHash, encodeHashToBase64, EntryHash } from '@holochain/client';
import { consume } from '@lit-labs/context';
import { localized, msg } from '@lit/localize';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  AsyncReadable,
  joinAsync,
  joinAsyncMap,
  pipe,
  StoreSubscriber,
  toPromise,
} from '@holochain-open-dev/stores';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import { mapValues, slice } from '@holochain-open-dev/utils';

import { weStoreContext } from '../../context.js';
import { WeStore } from '../../we-store.js';
import { GroupStore } from '../group-store.js';
import { groupStoreContext } from '../context.js';

@localized()
@customElement('federate-applet-dialog')
export class FederateAppletDialog extends LitElement {
  @consume({ context: weStoreContext })
  _weStore!: WeStore;

  @consume({ context: groupStoreContext })
  _groupStore!: GroupStore;

  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  _groups = new StoreSubscriber(
    this,
    () =>
      pipe(
        joinAsync([
          this._weStore.groupStores,
          this._weStore.groupsForApplet.get(this.appletHash),
        ]) as AsyncReadable<[ReadonlyMap<DnaHash, GroupStore>, ReadonlyMap<DnaHash, GroupStore>]>,
        ([allGroups, groupsForThisApplet]) => {
          const groupsToFederate = Array.from(allGroups.keys()).filter(
            (groupDnaHash) =>
              groupDnaHash.toString() !== this._groupStore.groupDnaHash.toString() &&
              !Array.from(groupsForThisApplet.keys()).find(
                (g) => g.toString() === groupDnaHash.toString(),
              ),
          );
          return joinAsyncMap(
            mapValues(
              slice(allGroups, groupsToFederate) as ReadonlyMap<DnaHash, GroupStore>,
              (groupStore) => groupStore?.groupProfile,
            ),
          );
        },
      ),
    () => [this.appletHash],
  );

  @state()
  federating = false;

  async federateApplet(groupDnaHash: DnaHash) {
    if (this.federating) return;

    this.federating = true;
    try {
      const appletStore = await toPromise(this._weStore.appletStores.get(this.appletHash));
      const groupStore = await this._weStore.groupStore(groupDnaHash);

      if (!groupStore) throw new Error('Failed to federate Applet: GroupStore not found.');

      if (!appletStore) throw new Error('Applet not found');

      const applet = appletStore.applet;
      await groupStore.addFederatedApplet(applet);

      // Two way link from one group to the other
      // TODO: what to do when the applet is uninstalled?
      await this._groupStore.groupClient.registerAppletFederation(this.appletHash, groupDnaHash);
      await groupStore.groupClient.registerAppletFederation(
        this.appletHash,
        this._groupStore.groupDnaHash,
      );
      notify(msg('Applet federated.'));
      const dialog = this.shadowRoot?.getElementById('dialog') as SlDialog;
      dialog.hide();
    } catch (e) {
      notifyError(msg('Error federating applet.'));
      console.error(e);
    }

    this.federating = false;
  }

  renderDialogContent() {
    switch (this._groups.value.status) {
      case 'pending':
        return html`<div class="row center-content" style="flex: 1">
          <sl-spinner style="font-size: 2rem"></sl-spinner>
        </div>`;
      case 'complete':
        const groups = Array.from(this._groups.value.value.entries());

        return html`
          <form
            id="form"
            ${onSubmit((f) => this.federateApplet(decodeHashFromBase64(f.groupDnaHash)))}
          >
            <span
              >${msg(
                'Federating this applet will share it with another group you are part of, so that both groups have the same applet installed and their members can access it.',
              )}</span
            ><br /><br />
            <span>${msg('With which group do you want to federate this applet?')}</span>
            <sl-select
              .placeholder=${msg('Select Group')}
              name="groupDnaHash"
              @sl-hide=${(e) => e.stopPropagation()}
              style="margin-top: 16px"
              hoist
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
            .loading=${this.federating}
            variant="primary"
            type="submit"
            form="form"
            >${msg('Federate')}</sl-button
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
      .label=${msg('Federate Applet')}
      open
      @sl-request-close=${(e) => {
        if (this.federating) {
          e.preventDefault();
        }
      }}
    >
      ${this.renderDialogContent()}
    </sl-dialog>`;
  }
}

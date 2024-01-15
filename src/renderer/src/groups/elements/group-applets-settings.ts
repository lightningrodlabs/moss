import {
  asyncDeriveAndJoin,
  AsyncReadable,
  joinAsync,
  mapAndJoin,
  pipe,
  sliceAndJoin,
  StoreSubscriber,
} from '@holochain-open-dev/stores';
import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { localized, msg } from '@lit/localize';
import { DnaHash, EntryHash } from '@holochain/client';
import { hashState } from '@holochain-open-dev/elements';
import { AppletHash } from '@lightningrodlabs/we-applet';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';

import './federate-applet-dialog.js';
import './applet-detail-card.js';
import './group-context.js';
import './group-logo.js';
import '../../applets/elements/applet-logo.js';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import '../../elements/sidebar-button.js';
import { weStyles } from '../../shared-styles.js';
import { Applet } from '../../applets/types.js';
import { WeStore } from '../../we-store.js';
import { weStoreContext } from '../../context.js';
import { GroupDnaHash } from '../../types.js';

@localized()
@customElement('group-applets-settings')
export class GroupAppletsSettings extends LitElement {
  @consume({ context: weStoreContext, subscribe: true })
  _weStore!: WeStore;

  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

  _groupApplets = new StoreSubscriber(
    this,
    () =>
      joinAsync([
        asyncDeriveAndJoin(
          pipe(this._groupStore.allMyApplets, (myApplets) =>
            sliceAndJoin(this._groupStore.applets, myApplets),
          ),
          (applets) =>
            mapAndJoin(applets, (_applet, appletHash) =>
              this._groupStore.appletFederatedGroups.get(appletHash),
            ),
        ),
      ]) as AsyncReadable<
        [
          ReadonlyMap<AppletHash, Applet>,
          ReadonlyMap<AppletHash, Array<GroupDnaHash>>, // Groups the Applet has been federated with
        ]
      >,
    () => [this._groupStore, this._weStore],
  );

  @state(hashState())
  appletToDisable: EntryHash | undefined;

  @state(hashState())
  appletToUnarchive: EntryHash | undefined;

  @state(hashState())
  appletToFederate: EntryHash | undefined;

  @state()
  archiving = false;

  @state()
  unarchiving = false;

  renderFederateDialog() {
    if (!this.appletToFederate) return html``;

    return html`<federate-applet-dialog
      .appletHash=${this.appletToFederate}
      @sl-hide=${() => {
        this.appletToFederate = undefined;
      }}
    ></federate-applet-dialog>`;
  }

  renderInstalledApplets(
    applets: ReadonlyMap<EntryHash, Applet>,
    federatedGroups: ReadonlyMap<EntryHash, Array<DnaHash>>,
  ) {
    if (applets.size === 0)
      return html`
        <div class="row center-content" style="flex: 1">
          <span
            class="placeholder"
            style="margin: 24px; text-align: center; max-width: 600px; font-size: 20px;"
            >${msg(
              "This group doesn't have any applets installed yet. Go to the applet library to install applets to this group.",
            )}
          </span>
        </div>
      `;
    return html`
      ${this.renderFederateDialog()}
      <div class="column" style="flex: 1;">
        ${Array.from(applets.entries())
          .sort(([_, a], [__, b]) => a.custom_name.localeCompare(b.custom_name))
          .map(
            ([appletHash, applet]) => html`
              <applet-detail-card
                @federate-applet=${(e) => {
                  this.appletToFederate = e.detail;
                }}
                @disable-applet=${(e) => {
                  this.appletToDisable = e.detail;
                }}
                .appletHash=${appletHash}
                .applet=${applet}
                .federatedGroups=${federatedGroups}
              ></applet-detail-card>
            `,
          )}
      </div>
    `;
  }

  render() {
    switch (this._groupApplets.value?.status) {
      case 'pending':
        return html` <div class="column center-content" style="flex: 1;">
          <sl-spinner style="font-size: 30px;"></sl-spinner>
        </div>`;
      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching the applets installed in this group')}
          .error=${this._groupApplets.value.error}
        ></display-error>`;
      case 'complete':
        return html`
          <div
            class="column"
            style="flex: 1; align-items: center; overflow: auto; padding: 30px 10px 20px 10px; --sl-border-radius-medium: 20px;"
          >
            <span class="title" style="margin-bottom: 30px; font-size: 28px;"
              >${msg('Installed Applets')}</span
            >
            ${this.renderInstalledApplets(
              this._groupApplets.value.value[0][0],
              this._groupApplets.value.value[0][1],
            )}
          </div>
        `;
    }
  }

  static styles = [
    weStyles,
    css`
      :host {
        display: flex;
        background-color: #e1e1e1;
      }
    `,
  ];
}

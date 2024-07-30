import { AsyncReadable, pipe, sliceAndJoin, StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { encodeHashToBase64, EntryHash } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import '../groups/elements/group-context.js';
import '../elements/applet-topbar-button.js';
import './create-group-dialog.js';
import './topbar-button.js';

import { mossStoreContext } from '../context.js';
import { MossStore } from '../moss-store.js';
import { weStyles } from '../shared-styles.js';
import { AppletStore } from '../applets/applet-store.js';
import { GroupStore } from '../groups/group-store.js';
import { groupStoreContext } from '../groups/context.js';
import { AppletHash, AppletId } from '@lightningrodlabs/we-applet';
import { mdiHome } from '@mdi/js';
import { wrapPathInSvg } from '@holochain-open-dev/elements';

// Sidebar for the applet instances of a group
@localized()
@customElement('group-applets-sidebar')
export class GroupAppletsSidebar extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore: GroupStore | undefined;

  @property()
  selectedAppletHash?: AppletHash;

  @property()
  indicatedAppletHashes: AppletId[] = [];

  // All the Applets that are running and part of this Group
  _groupApplets = new StoreSubscriber(
    this,
    () =>
      this._groupStore
        ? (pipe(this._groupStore.allMyRunningApplets, (myRunningApplets) =>
            sliceAndJoin(this.mossStore.appletStores, myRunningApplets),
          ) as AsyncReadable<ReadonlyMap<EntryHash, AppletStore>>)
        : (undefined as unknown as AsyncReadable<ReadonlyMap<EntryHash, AppletStore>>),
    () => [this._groupStore],
  );

  renderApplets(applets: ReadonlyMap<EntryHash, AppletStore>) {
    if (Array.from(applets.entries()).length === 0) {
      return html`
        <div class="row" style="align-items: center; font-size: 20px; font-weight: 500;">
          <span style="color: #fff; font-size: 14px; opacity: .5;">
            No applets installed or all applets disabled...
          </span>
        </div>
      `;
    }

    return html`
      <div class="row" style="align-items: flex-end;">
        ${Array.from(applets.entries())
          .sort((a1, a2) => a1[1].applet.custom_name.localeCompare(a2[1].applet.custom_name))
          .map(
            ([_appletBundleHash, appletStore]) => html`
              <applet-topbar-button
                .appletStore=${appletStore}
                .selected=${this.selectedAppletHash &&
                this.selectedAppletHash.toString() === appletStore.appletHash.toString()}
                .indicated=${this.indicatedAppletHashes.includes(
                  encodeHashToBase64(appletStore.appletHash),
                )}
                .tooltipText=${appletStore.applet.custom_name}
                placement="bottom"
                @click=${() => {
                  this.dispatchEvent(
                    new CustomEvent('applet-selected', {
                      detail: {
                        groupDnaHash: this._groupStore!.groupDnaHash,
                        appletHash: appletStore.appletHash,
                      },
                      bubbles: true,
                      composed: true,
                    }),
                  );
                  appletStore.clearNotificationStatus();
                }}
              >
              </applet-topbar-button>
            `,
          )}
      </div>
    `;
  }

  renderAppletsLoading() {
    if (!this._groupStore) return html``;
    switch (this._groupApplets.value.status) {
      case 'pending':
        return html`<sl-skeleton
            style="height: 58px; width: 58px; margin-right: 10px; --border-radius: 20%;"
            effect="pulse"
          ></sl-skeleton>
          <sl-skeleton
            style="height: 58px; width: 58px; margin-right: 10px; --border-radius: 20%;"
            effect="pulse"
          ></sl-skeleton>
          <sl-skeleton
            style="height: 58px; width: 58px; margin-right: 10px; --border-radius: 20%;"
            effect="pulse"
          ></sl-skeleton> `;
      case 'error':
        console.error('ERROR: ', this._groupApplets.value.error);
        return html`<display-error
          .headline=${msg('Error displaying the applets')}
          tooltip
          .error=${this._groupApplets.value.error}
        ></display-error>`;
      case 'complete':
        return this.renderApplets(this._groupApplets.value.value);
    }
  }

  renderMossButtons() {
    return html`
      <topbar-button
        style="position: relative;"
        .selected=${!this.selectedAppletHash}
        .tooltipText=${'Home'}
        placement="bottom"
        @click=${() => {
          this.dispatchEvent(
            new CustomEvent('group-home-selected', {
              bubbles: false,
              composed: true,
            }),
          );
        }}
      >
        <div class="moss-item-button">
          <sl-icon .src=${wrapPathInSvg(mdiHome)} style="font-size: 40px;"></sl-icon>
        </div>
      </topbar-button>
    `;
  }

  render() {
    return html`
      <div class="row" style="flex: 1; align-items: center;">
        ${this.renderMossButtons()} ${this.renderAppletsLoading()}
      </div>
    `;
  }

  static styles = [
    weStyles,
    css`
      :host {
        display: flex;
      }

      .moss-item-button {
        display: flex;
        justify-content: center;
        align-items: center;
        border-radius: 50%;
        background: #0b2f00;
        color: #dbe755;
        width: 58px;
        height: 58px;
      }
    `,
  ];
}

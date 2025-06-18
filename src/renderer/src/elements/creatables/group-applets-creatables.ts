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

import '../../groups/elements/group-context.js';
import '../../applets/elements/applet-logo-raw.js';
import '../navigation/applet-topbar-button.js';
import '../dialogs/create-group-dialog.js';
import '../../applets/elements/applet-title.js';

import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { mossStyles } from '../../shared-styles.js';
import { AppletStore } from '../../applets/applet-store.js';
import { GroupStore } from '../../groups/group-store.js';
import { groupStoreContext } from '../../groups/context.js';
import { AppletId, CreatableType } from '@theweave/api';

// Sidebar for the applet instances of a group
@localized()
@customElement('group-applets-creatables')
export class GroupAppletsCreatables extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

  @property()
  activeApplets: AppletId[] | undefined;

  // All the Applets that are running and part of this Group
  _groupApplets = new StoreSubscriber(
    this,
    () =>
      pipe(this._groupStore.allMyRunningApplets, (myRunningApplets) =>
        sliceAndJoin(this.mossStore.appletStores, myRunningApplets),
      ) as AsyncReadable<ReadonlyMap<EntryHash, AppletStore>>,
    () => [this._groupStore],
  );

  _allCreatableTypes = new StoreSubscriber(
    this,
    () => this.mossStore.allCreatableTypes(),
    () => [this.mossStore],
  );

  renderCreatables(applets: ReadonlyMap<EntryHash, AppletStore>) {
    const creatables: [CreatableType, AppletStore][] = [];
    applets.forEach((appletStore, appletHash) => {
      const creatableTypesRecord = this._allCreatableTypes.value[encodeHashToBase64(appletHash)];
      if (creatableTypesRecord) {
        const creatableTypes: [CreatableType, AppletStore][] = Object.values(
          creatableTypesRecord,
        ).map((creatableType) => [creatableType, appletStore]);
        creatables.push(...creatableTypes);
      }
    });

    if (creatables.length === 0)
      return html`<div style="margin-top: 30px;">
        ${msg('No Creatables available for the selected Group.')}
      </div>`;

    return html`
      <div class="row creatable-container justify-center" style="flex: 1;">
        ${creatables.map(
          ([creatableType, appletStore]) =>
            html` <div
              class="column creatable-item"
              style="cursor: pointer;"
              tabindex="0"
              @click=${() => {
                this.dispatchEvent(
                  new CustomEvent('creatable-selected', {
                    detail: {
                      appletHash: appletStore.appletHash,
                      creatableName: creatableType.label,
                      creatable: creatableType,
                    },
                    bubbles: true,
                    composed: true,
                  }),
                );
              }}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  this.dispatchEvent(
                    new CustomEvent('creatable-selected', {
                      detail: {
                        appletHash: appletStore.appletHash,
                        creatableName: creatableType.label,
                        creatable: creatableType,
                      },
                      bubbles: true,
                      composed: true,
                    }),
                  );
                }
              }}
            >
              <div class="row items-center">
                <sl-icon
                  style="height: 35px; width: 35px;"
                  .src=${creatableType.icon_src}
                  alt="${creatableType.label} creatable type icon"
                ></sl-icon>
                <div style="margin-left: 5px;">${creatableType.label}</div>
                <span style="display: flex; flex: 1;"></span>
              </div>
              <div style="display: flex; flex: 1;"></div>
              <div class="row items-center">
                <span style="display: flex; flex: 1;"></span>
                <applet-title
                  .appletHash=${appletStore.appletHash}
                  invert
                  style="--font-size: 12px; --size: 20px;"
                ></applet-title>
              </div>
            </div>`,
        )}
      </div>
    `;
  }

  renderCreatablesLoading() {
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
        return this.renderCreatables(this._groupApplets.value.value);
    }
  }

  render() {
    return html`
      <div class="row" style="flex: 1; align-items: center;">${this.renderCreatablesLoading()}</div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: flex;
      }

      .applet-logo {
        cursor: pointer;
      }

      .disabled {
        opacity: 0.3;
      }

      .creatable-container {
        max-width: 680px;
        max-height: 450px;
        overflow-y: auto;
        flex-wrap: wrap;
      }

      .creatable-item {
        position: relative;
        border-radius: 10px;
        padding: 5px;
        padding-top: 8px;
        background: var(--sl-color-tertiary-200);
        margin: 4px;
        width: 200px;
        min-height: 60px;
      }

      .creatable-item:hover {
        background: var(--sl-color-tertiary-500);
      }
    `,
  ];
}

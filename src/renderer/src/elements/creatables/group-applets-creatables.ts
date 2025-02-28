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
import { weStyles } from '../../shared-styles.js';
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

    return html`
      <div class="column creatable-container" style="margin-top: 10px; flex: 1;">
        ${creatables.map(
          ([creatableType, appletStore]) =>
            html` <div
              class="row creatable-item"
              style="align-items: center; cursor: pointer;"
              tabindex="0"
              @click=${() => {}}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                }
              }}
            >
              <sl-icon
                style="height: 35px; width: 35px;"
                .src=${creatableType.icon_src}
                alt="${creatableType.label} creatable type icon"
              ></sl-icon>
              <div style="margin-left: 5px;">${creatableType.label}</div>
              <span style="display: flex; flex: 1;"></span>
              <span style="margin-right: 4px;">${msg('from')}</span>
              <applet-title .appletHash=${appletStore.appletHash}></applet-title>
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
    weStyles,
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
        width: 500px;
        max-height: 450px;
        overflow-y: auto;
      }

      .creatable-item {
        flex: 1;
        border-radius: 5px;
        padding: 5px;
      }

      .creatable-item:hover {
        background: var(--sl-color-primary-200);
      }
    `,
  ];
}

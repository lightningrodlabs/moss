import { AsyncReadable, pipe, sliceAndJoin, StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { DnaHashB64, encodeHashToBase64, EntryHash } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import '../../groups/elements/group-context.js';
import './applet-topbar-button.js';
import '../dialogs/create-group-dialog.js';

import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { mossStyles } from '../../shared-styles.js';
import { AppletStore } from '../../applets/applet-store.js';
import { GroupStore } from '../../groups/group-store.js';
import { groupStoreContext } from '../../groups/context.js';
import { AppletHash, AppletId } from '@theweave/api';
import { mdiHome } from '@mdi/js';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { repeat } from 'lit/directives/repeat.js';
import { PersistedStore } from '../../persisted-store.js';

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

  @state()
  dragged: AppletId | null = null;

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
          <span style="color: var(--moss-dark-green); font-size: 14px; margin-left: 10px;">
            No Tools installed or all Tools disabled...
          </span>
        </div>
      `;
    }
    const groupId = encodeHashToBase64(this._groupStore!.groupDnaHash);

    let customAppletOrder = this.mossStore.persistedStore.groupAppletOrder.value(groupId);
    if (!customAppletOrder) {
      customAppletOrder = Array.from(applets.entries())
        .sort(([_, a], [__, b]) => a.applet.custom_name.localeCompare(b.applet.custom_name))
        .map(([hash, _profile]) => encodeHashToBase64(hash));
      this.mossStore.persistedStore.groupAppletOrder.set(customAppletOrder, groupId);
    }
    Array.from(applets.entries()).forEach(([hash, _]) => {
      if (!customAppletOrder!.includes(encodeHashToBase64(hash))) {
        customAppletOrder!.splice(0, 0, encodeHashToBase64(hash));
      }
      this.mossStore.persistedStore.groupAppletOrder.set(customAppletOrder!, groupId);
      this.requestUpdate();
    });

    return html`
      <div class="row" style="align-items: flex-end; position: relative;">
        <div
          class="row center-content dropzone"
          style="position: absolute;"
          @dragenter=${(e: DragEvent) => {
            (e.target as HTMLElement).classList.add('active');
          }}
          @dragleave=${(e: DragEvent) => {
            (e.target as HTMLElement).classList.remove('active');
          }}
          @dragover=${(e: DragEvent) => {
            e.preventDefault();
          }}
          @drop=${(e: DragEvent) => {
            e.preventDefault();
            const dropAppletId = undefined;
            storeNewAppletOrder(this.dragged!, dropAppletId, groupId);
            this.requestUpdate();
          }}
        >
          <div class="dropzone-indicator"></div>
        </div>
        ${repeat(
          Array.from(applets.entries()).sort(
            ([a_hash, _a], [b_hash, _b]) =>
              customAppletOrder!.indexOf(encodeHashToBase64(a_hash)) -
              customAppletOrder!.indexOf(encodeHashToBase64(b_hash)),
          ),
          ([appletHash, _appletStore]) => encodeHashToBase64(appletHash),
          ([appletHash, appletStore]) => html`
            <div style="position: relative;">
              <applet-topbar-button
                id="${`groupAppletIcon#${encodeHashToBase64(appletHash)}`}"
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
                draggable="true"
                @dragstart=${(e: DragEvent) => {
                  console.log('DRAGSTART!');
                  (e.target as HTMLElement).classList.add('dragging');
                  this.dragged = encodeHashToBase64(appletHash);
                }}
                @dragend=${(e: DragEvent) => {
                  (e.target as HTMLElement).classList.remove('dragging');
                  Array.from(
                    (
                      e.target as HTMLElement
                    ).parentElement!.parentElement!.parentElement!.getElementsByClassName(
                      'dropzone',
                    ),
                  ).forEach((el) => {
                    el.classList.remove('active');
                  });
                  this.dragged = null;
                }}
              >
              </applet-topbar-button>
              <div
                class="row center-content dropzone right"
                style="position: absolute;"
                @dragenter=${(e: DragEvent) => {
                  (e.target as HTMLElement).classList.add('active');
                }}
                @dragleave=${(e: DragEvent) => {
                  (e.target as HTMLElement).classList.remove('active');
                }}
                @dragover=${(e: DragEvent) => {
                  e.preventDefault();
                }}
                @drop=${(e: DragEvent) => {
                  e.preventDefault();
                  const dropAppletId = (e.target as HTMLElement).previousElementSibling!.id.slice(
                    16,
                  );
                  storeNewAppletOrder(this.dragged!, dropAppletId, groupId);
                  this.requestUpdate();
                }}
              >
                <div class="dropzone-indicator"></div>
              </div>
            </div>
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
            style="height: 48px; width: 48px; margin-right: 10px; --border-radius: 20%;"
            effect="pulse"
          ></sl-skeleton>
          <sl-skeleton
            style="height: 48px; width: 48px; margin-right: 10px; --border-radius: 20%;"
            effect="pulse"
          ></sl-skeleton>
          <sl-skeleton
            style="height: 48px; width: 48px; margin-right: 10px; --border-radius: 20%;"
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
    mossStyles,
    css`
      :host {
        display: flex;
      }

      .moss-item-button {
        display: flex;
        justify-content: center;
        align-items: center;
        /* border-radius: 50%; */
        border-radius: 8px;
        /* background: #0b2f00; */
        /* background: var(--moss-dark-green); */
        /* color: #dbe755; */
        /* color: var(--moss-main-green); */
        color: var(--moss-dark-green);
        width: 48px;
        height: 48px;
        /* box-shadow: 1px 2px 10px 0px #102520ab; */
      }

      .dropzone {
        height: 58px;
        width: 4px;
        top: 6px;
        padding: 4px 0;
        z-index: 1;
      }

      .dropzone-indicator {
        position: absolute;
        bottom: 54px;
        left: -8px;
        width: 0;
        height: 0;
        border-right: 10px solid transparent;
        border-top: 20px solid var(--sl-color-primary-100);
        border-left: 10px solid transparent;
        display: none;
      }

      .active .dropzone-indicator {
        display: block;
      }

      .right {
        position: absolute;
        right: 0;
      }
    `,
  ];
}

function storeNewAppletOrder(
  draggedHash: AppletId,
  droppedHash: AppletId | undefined,
  groupId: DnaHashB64,
) {
  if (draggedHash === droppedHash) return;
  // TODO potentially make this more resilient and remove elements of deleted groups
  const persistedStore = new PersistedStore();
  const groupAppletOrder = persistedStore.groupAppletOrder.value(groupId);
  const currentIdx = groupAppletOrder.indexOf(draggedHash);
  groupAppletOrder.splice(currentIdx, 1);
  const newIdx = droppedHash ? groupAppletOrder.indexOf(droppedHash) + 1 : 0;
  groupAppletOrder.splice(newIdx, 0, draggedHash);
  persistedStore.groupAppletOrder.set(groupAppletOrder, groupId);
}

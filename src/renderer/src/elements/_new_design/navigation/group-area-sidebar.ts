import {
  AsyncReadable,
  AsyncStatus,
  joinAsync,
  pipe,
  sliceAndJoin,
  StoreSubscriber,
} from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { DnaHashB64, DnaModifiers, encodeHashToBase64, EntryHash } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import { AppletHash, AppletId, GroupProfile } from '@theweave/api';
import { repeat } from 'lit/directives/repeat.js';
import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';
import { groupStoreContext } from '../../../groups/context.js';
import { GroupStore } from '../../../groups/group-store.js';
import { AppletStore } from '../../../applets/applet-store.js';
import { mossStyles } from '../../../shared-styles.js';
import { PersistedStore } from '../../../persisted-store.js';

import './applet-sidebar-button.js';
import { circleHalfIcon, plusIcon } from '../icons.js';
import { Profile, ProfilesStore, profilesStoreContext } from '@holochain-open-dev/profiles';
import { EntryRecord } from '@holochain-open-dev/utils';

// Sidebar for the applet instances of a group
@localized()
@customElement('group-area-sidebar')
export class GroupAppletsSidebar extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  private _groupStore!: GroupStore;

  @consume({ context: profilesStoreContext, subscribe: true })
  @property()
  profileStore!: ProfilesStore;

  @property()
  selectedAppletHash?: AppletHash;

  @property()
  indicatedAppletHashes: AppletId[] = [];

  @state()
  collapsed = true;

  @state()
  dragged: AppletId | null = null;

  permissionType = new StoreSubscriber(
    this,
    () => this._groupStore.permissionType,
    () => [this._groupStore],
  );

  groupProfile = new StoreSubscriber(
    this,
    () => {
      const store = joinAsync([
        this._groupStore.groupProfile,
        this._groupStore.modifiers,
      ]) as AsyncReadable<[GroupProfile | undefined, DnaModifiers]>;
      // (window as any).groupProfileStore = store;
      return store;
    },
    () => [this._groupStore, this.mossStore],
  );

  _peerStatuses = new StoreSubscriber(
    this,
    () => this._groupStore.peerStatuses(),
    () => [this._groupStore],
  );

  _myProfile: StoreSubscriber<AsyncStatus<EntryRecord<Profile> | undefined>> = new StoreSubscriber(
    this,
    () => this._groupStore.profilesStore.myProfile,
    () => [this._groupStore],
  );

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
      <div class="column;" style="position: relative;">
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
              <sl-tooltip content="${appletStore.applet.custom_name}" placement="right" hoist>
                <applet-sidebar-button
                  id="${`groupAppletIcon#${encodeHashToBase64(appletHash)}`}"
                  .appletStore=${appletStore}
                  .selected=${this.selectedAppletHash &&
                  this.selectedAppletHash.toString() === appletStore.appletHash.toString()}
                  ?collapsed=${this.collapsed}
                  .indicated=${this.indicatedAppletHashes.includes(
                    encodeHashToBase64(appletStore.appletHash),
                  )}
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
                </applet-sidebar-button>
              </sl-tooltip>
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
    if (!this._groupStore) return html`group hash undefined.`;
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

  // renderMossButtons() {
  //   return html`
  //     <topbar-button
  //       style="position: relative;"
  //       .selected=${!this.selectedAppletHash}
  //       .tooltipText=${'Home'}
  //       placement="bottom"
  //       @click=${() => {
  //         this.dispatchEvent(
  //           new CustomEvent('group-home-selected', {
  //             bubbles: false,
  //             composed: true,
  //           }),
  //         );
  //       }}
  //     >
  //       <div class="moss-item-button">
  //         <sl-icon .src=${wrapPathInSvg(mdiHome)} style="font-size: 40px;"></sl-icon>
  //       </div>
  //     </topbar-button>
  //   `;
  // }

  renderGroupLogo() {
    switch (this.groupProfile.value.status) {
      case 'pending':
        return html`<sl-skeleton
          style="height: var(--size, ${this.collapsed ? '35px' : '28px'}); width: var(--size, ${this
            .collapsed
            ? '35px'
            : '28px'}); --border-radius: 8px"
          effect="pulse"
        ></sl-skeleton> `;
      case 'complete':
        return html`
          ${this.groupProfile.value.value[0]?.icon_src
            ? html`<img
                class="icon ${this.collapsed ? 'icon-large' : ''}"
                .src=${this.groupProfile.value.value[0].icon_src}
                alt=${`${this.groupProfile.value.value[0].name} group icon`}
              />`
            : html`<div class="column center-content icon" style="background: gray;">?</div>`}
        `;
      case 'error':
        console.error('Failed to fetch group profile: ', this.groupProfile.value.error);
        return html`<display-error
          tooltip
          .headline=${msg('Error fetching the group profile')}
          .error=${this.groupProfile.value.error}
        ></display-error>`;
    }
  }

  groupName() {
    switch (this.groupProfile.value.status) {
      case 'pending':
        return msg('Loading...');
      case 'complete':
        return this.groupProfile.value.value[0]?.name
          ? this.groupProfile.value.value[0]?.name
          : 'unknown';
      case 'error':
        return 'ERROR';
    }
  }

  renderMyProfileAvatar() {
    switch (this._myProfile.value.status) {
      case 'pending':
        return html`<sl-skeleton
          style="height: var(--size, ${this.collapsed ? '35px' : '28px'}); width: var(--size, ${this
            .collapsed
            ? '35px'
            : '28px'}); --border-radius: 8px"
          effect="pulse"
        ></sl-skeleton> `;
      case 'complete':
        return html`
          ${this._myProfile.value.value?.entry?.fields.avatar
            ? html`<img
                class="icon ${this.collapsed ? 'icon-large' : ''}"
                .src=${this._myProfile.value.value.entry.fields.avatar}
                alt=${msg('my profile image')}
              />`
            : html`<div class="column center-content icon" style="background: gray;">?</div>`}
        `;
      case 'error':
        // console.error('Failed to fetch group profile: ', this._myProfile.value.error);
        return html`<display-error
          tooltip
          .headline=${msg('Error fetching the group profile')}
          .error=${this._myProfile.value.error}
        ></display-error>`;
    }
  }

  myProfileNickName() {
    switch (this._myProfile.value.status) {
      case 'pending':
        return msg('Loading...');
      case 'complete':
        return this._myProfile.value.value?.entry.nickname
          ? this._myProfile.value.value?.entry.nickname
          : 'unknown';
      case 'error':
        return 'ERROR';
    }
  }

  numPeersOnline(): number | undefined {
    if (!this._peerStatuses.value) return undefined;
    const myPubKeyB64 = encodeHashToBase64(this._groupStore.groupClient.myPubKey);
    // We don't count ourselves as online
    return Object.entries(this._peerStatuses.value).filter(
      ([pubkeyB64, status]) =>
        pubkeyB64 !== myPubKeyB64 && ['online', 'inactive'].includes(status.status),
    ).length;
  }

  renderPeersOnline() {
    if (!this._peerStatuses.value) return html`??<span style="color: #505050;">/??</span>`;
    const totalPeers = Object.keys(this._peerStatuses.value).length;
    return html`${this.numPeersOnline()}<span style="color: #505050;">/${totalPeers - 1}</span>`; // We don't count ourselves to the totl number of peers
  }

  render() {
    return html`
      <div
        class="column flex-1 container ${this.collapsed ? 'container-collapsed' : ''}"
        style="margin-top: 2px;"
      >
        <!-- group home button -->
        <sl-tooltip content="${this.groupName()}" placement="right" hoist>
          <button
            class="btn ${!this.selectedAppletHash ? 'selected' : ''}"
            @click=${() => {
              this.dispatchEvent(
                new CustomEvent('group-home-selected', {
                  bubbles: false,
                  composed: true,
                }),
              );
            }}
          >
            <div class="row items-center">
              <div class="row items-center">${this.renderGroupLogo()}</div>
              ${this.collapsed
                ? html``
                : html`<div class="row items-center" style="margin-left: 4px;">
                    ${this.groupName()}
                  </div>`}
            </div>
          </button>
        </sl-tooltip>

        <!-- Online Peers indicator -->
        <sl-tooltip
          content="${msg('Your Peers')}${this._peerStatuses.value
            ? ` (${this.numPeersOnline()} online)`
            : ''}"
          placement="right"
          hoist
        >
          <button class="btn">
            <div class="column center-content">
              <div>${circleHalfIcon(12)}</div>
              <div style="font-size: 16px;">${this.renderPeersOnline()}</div>
            </div>
          </button>
        </sl-tooltip>

        <!-- My own Profile -->
        <sl-tooltip content="${this.myProfileNickName()} (me)" placement="right" hoist>
          <button class="btn">
            <div class="row items-center">
              ${this.renderMyProfileAvatar()}
              ${this.collapsed
                ? html``
                : html`<div style="margin-left: 5px;">
                    ${this.myProfileNickName()} ${msg('(me)')}
                  </div>`}
            </div>
          </button>
        </sl-tooltip>

        <div class="ruler" style="margin-top: 20px;"></div>

        <!-- Tool Buttons -->
        <div class="section-title" style="margin-bottom: 10px;">${msg('Tools')}</div>
        ${this.renderAppletsLoading()}
        <sl-tooltip content="${msg('add a tool')}" placement="bottom">
          <button
            class="purple-btn"
            @click=${() => {
              this.dispatchEvent(
                new CustomEvent('add-tool-requested', {
                  bubbles: false,
                  composed: true,
                }),
              );
            }}
          >
            <div class="column center-content">${plusIcon()}</div>
          </button>
        </sl-tooltip>
      </div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: flex;
        padding: 4px;
      }

      .container {
        width: 170px;
      }

      .container-collapsed {
        width: 43px;
      }

      .ruler {
        height: 1px;
        background: var(--moss-dark-button);
        width: 160px;
        opacity: 0.2;
      }

      .section-title {
        font-size: 12px;
        color: var(--moss-dark-button);
        opacity: 0.6;
      }

      .btn {
        all: unset;
        padding: 4px;
        border-radius: 12px;
        margin: 2px 0;
        font-size: 16px;
        cursor: pointer;
      }

      .btn:hover:not(.selected) {
        background: #ffffff84;
      }

      .btn:focus-visible {
        outline: 2px solid var(--moss-purple);
      }

      .purple-btn {
        all: unset;
        padding: 4px;
        border-radius: 12px;
        margin: 2px 0;
        font-size: 16px;
        cursor: pointer;
        color: var(--moss-purple);
        height: 30px;
      }

      .purple-btn:focus-visible {
        outline: 2px solid var(--moss-purple);
      }

      .purple-btn:hover {
        background: #7461eb33;
      }

      .icon {
        height: 28px;
        width: 28px;
        border-radius: 8px;
      }

      .icon-large {
        height: 35px;
        width: 35px;
      }

      .selected {
        background: white;
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

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
import { customElement, property, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { DnaHashB64, DnaModifiers, encodeHashToBase64, EntryHash } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@holochain-open-dev/elements/dist/elements/holo-identicon.js';
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

import '../../../groups/elements/group-peers-status.js';
import './applet-sidebar-button.js';
import {
  chevronSingleUpIcon,
  chevronSingleDownIcon,
  chevronDoubleLeftIcon,
  chevronDoubleRightIcon,
  circleHalfIcon,
  downloadIcon,
  plusIcon,
  closeIcon,
  personPlusIcon,
  questionMarkInfoIcon,
} from '../icons.js';
import { Profile } from '@holochain-open-dev/profiles';
import {EntryRecord, GetonlyMap} from '@holochain-open-dev/utils';
import { AgentAndTzOffset } from '../../../groups/elements/group-peers-status.js';
import {
  localTimeFromUtcOffset,
  relativeTzOffsetString,
  UTCOffsetStringFromOffsetMinutes,
  safeSetInterval,
  SafeIntervalHandle,
} from '../../../utils.js';
import { MossDialog } from '../moss-dialog.js';
import '../group-settings/inactive-tools-dialog.js';
import '../invite-people-dialog.js';

// Sidebar for the applet instances of a group
@localized()
@customElement('group-area-sidebar')
export class GroupAppletsSidebar extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  private _mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  private _groupStore!: GroupStore;

  @property()
  selectedAppletHash?: AppletHash;

  @property()
  indicatedAppletHashes: AppletId[] = [];

  @state()
  dragged: AppletId | null = null;

  _peerStatusInterval: SafeIntervalHandle | undefined;

  _peersStatus = new StoreSubscriber(
    this,
    () => this._groupStore.peerStatuses(),
    () => [this._groupStore],
  );
  async firstUpdated() {
    // Broadcast peer status to applets periodically
    // Uses safeSetInterval to prevent call stacking
    this._peerStatusInterval = safeSetInterval({
      name: 'broadcastPeerStatus',
      fn: async () => {
        await this._groupStore.emitToGroupApplets({
          type: 'peer-status-update',
          payload: this._peersStatus.value ? this._peersStatus.value : {},
        });
      },
      intervalMs: 5000,
      runImmediately: false,
    });

    // const allGroupApplets = await this._groupStore.groupClient.getGroupApplets();
    await this._groupStore.groupDescription.reload();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._peerStatusInterval) {
      this._peerStatusInterval.cancel();
      this._peerStatusInterval = undefined;
    }
  }

  @state()
  _selectedAgent: AgentAndTzOffset | undefined;

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
    () => [this._groupStore, this._mossStore],
  );

  @query('#member-profile')
  _memberProfileDialog!: MossDialog;

  @query('invite-people-dialog')
  inviteMemberDialog: any;

  @query('inactive-tools-dialog')
  inactiveToolsDialog: any;

  private myAccountabilities = new StoreSubscriber(
    this,
    () => this._groupStore.myAccountabilities,
    () => [this._groupStore],
  );

  private _groupProfile = new StoreSubscriber(
    this,
    () => {
      const store = joinAsync([
        this._groupStore.groupProfile,
        this._groupStore.modifiers,
      ]) as AsyncReadable<[GroupProfile | undefined, DnaModifiers]>;
      // (window as any).groupProfileStore = store;
      return store;
    },
    () => [this._groupStore, this._mossStore],
  );

  private _groupMemberWithProfiles = new StoreSubscriber(
    this,
    () => this._groupStore?.allProfiles,
    () => [this._groupStore],
  );
  totalMembers() {
    switch (this._groupMemberWithProfiles.value?.status) {
      case 'complete':
        return this._groupMemberWithProfiles.value.value.size;
      default:
        return 1; // self
    }
  }
  private _onlinePeersCount = new StoreSubscriber(
    this,
    () => this._groupStore?.onlinePeersCount,
    () => [this._groupStore],
  );

  private _myProfile: StoreSubscriber<AsyncStatus<EntryRecord<Profile> | undefined>> =
    new StoreSubscriber(
      this,
      () => this._groupStore.profilesStore.myProfile,
      () => [this._groupStore],
    );

  // Foyer/group-level unread notification counts
  private _groupNotifications = new StoreSubscriber(
    this,
    () => this._groupStore.unreadGroupNotifications(),
    () => [this._groupStore],
  );

  // All the Applets that are running and part of this Group
  private _groupApplets = new StoreSubscriber(
    this,
    () =>
      this._groupStore
        ? (pipe(this._groupStore.allMyRunningApplets, (myRunningApplets) =>
          sliceAndJoin(this._mossStore.appletStores as GetonlyMap<any, any>, myRunningApplets),
        ) as AsyncReadable<ReadonlyMap<EntryHash, AppletStore>>)
        : (undefined as unknown as AsyncReadable<ReadonlyMap<EntryHash, AppletStore>>),
    () => [this._groupStore],
  );

  private _unjoinedApplets = new StoreSubscriber(
    this,
    () => this._groupStore.unjoinedApplets,
    () => [this._groupStore],
  );

  private _ignoredApplets = new StoreSubscriber(
    this,
    () => this._groupStore.ignoredApplets(),
    () => [this._groupStore],
  );

  private _collapsed = new StoreSubscriber(
    this,
    () => this._mossStore.appletSidebarCollapsed,
    () => [this._mossStore],
  );

  @state()
  get collapsed(): boolean | null {
    return this._collapsed.value;
  }

  @state()
  onlinePeersCollapsed: boolean = false;

  // TODO: Use MossPrivilege instead
  amIPrivileged() {
    if (this.myAccountabilities.value.status !== 'complete') {
      return false;
    }
    for (const acc of this.myAccountabilities.value.value) {
      if (acc.type === 'Steward' || acc.type == 'Progenitor') {
        return true;
      }
    }
    return false;
  }

  renderAppletButtons(applets: ReadonlyMap<EntryHash, AppletStore>) {
    const groupId = encodeHashToBase64(this._groupStore!.groupDnaHash);

    let customAppletOrder = this._mossStore.persistedStore.groupAppletOrder.value(groupId);
    if (!customAppletOrder) {
      customAppletOrder = Array.from(applets.entries())
        .sort(([_, a], [__, b]) => a.applet.custom_name.localeCompare(b.applet.custom_name))
        .map(([hash, _profile]) => encodeHashToBase64(hash));
      this._mossStore.persistedStore.groupAppletOrder.set(customAppletOrder, groupId);
    }
    Array.from(applets.entries()).forEach(([hash, _]) => {
      if (!customAppletOrder!.includes(encodeHashToBase64(hash))) {
        customAppletOrder!.splice(0, 0, encodeHashToBase64(hash));
      }
      this._mossStore.persistedStore.groupAppletOrder.set(customAppletOrder!, groupId);
      this.requestUpdate();
    });

    return html`
      <div class="column;" style="position: relative;">
        <div
          class="row center-content dropzone dropzone-top ${this.collapsed ? '' : 'dropzone-wide'}"
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
          <div class="dropzone-indicator ${this.collapsed ? '' : 'dropzone-indicator-wide'}"></div>
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
              <sl-tooltip
                content="${appletStore.applet.custom_name}"
                placement="right"
                hoist
                id="${`groupAppletIcon#${encodeHashToBase64(appletHash)}`}"
              >
                <applet-sidebar-button
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
                class="row center-content dropzone ${this.collapsed ? '' : 'dropzone-wide'}"
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
                <div
                  class="dropzone-indicator ${this.collapsed ? '' : 'dropzone-indicator-wide'}"
                ></div>
              </div>
            </div>
          `,
      )}
      </div>
    `;
  }

  renderAppletButtonsLoading() {
    if (!this._groupStore) return html`group hash undefined.`;
    switch (this._groupApplets.value.status) {
      case 'pending':
        return html`<sl-skeleton
            style="--color: #9d90f7; height: ${this.collapsed ? '35px' : '32px'}; width: ${this
            .collapsed
            ? '35px'
            : '170px'}; margin: 3px 0; --border-radius: 12px;"
            effect="pulse"
          ></sl-skeleton>
          <sl-skeleton
            style="--color: #9d90f7; height: ${this.collapsed ? '35px' : '32px'}; width: ${this
            .collapsed
            ? '35px'
            : '170px'}; margin: 3px 0; --border-radius: 12px;"
            effect="pulse"
          ></sl-skeleton>
          <sl-skeleton
            style="--color: #9d90f7; height: ${this.collapsed ? '35px' : '32px'}; width: ${this
            .collapsed
            ? '35px'
            : '170px'}; margin: 3px 0; --border-radius: 12px;"
            effect="pulse"
          ></sl-skeleton> `;
      case 'error':
        console.error('ERROR: ', this._groupApplets.value.error);
        return html`<display-error
          .headline=${msg('Error displaying the Tools')}
          tooltip
          .error=${this._groupApplets.value.error}
        ></display-error>`;
      case 'complete':
        return this._groupApplets.value.value.size === 0 && !this.collapsed && this.amIPrivileged()
          ? html`<div
              class="column items-center"
              style="background: var(--moss-light-green); border-radius: 12px; padding: 6px;"
            >
              <div style="text-align: center; margin-bottom: 10px;">
                ${msg('No tools yet.')}<br />${msg("Let's change that:")}
              </div>
              <button
                class="moss-button flex flex-1"
                style="padding-top: 10px; padding-bottom: 10px; border-radius: 10px; width: 120px; font-size: 16px;"
                @click=${() => {
              // If there are unactivated tools, open inactive tools dialog
              // Otherwise, open tool library
              if (this.numUnjoinedTools() && this.numUnjoinedTools()! > 0) {
                this.dispatchEvent(
                  new CustomEvent('group-home-selected', {
                    bubbles: false,
                    composed: true,
                  }),
                );
                this.dispatchEvent(
                  new CustomEvent('unjoined-tools-clicked', {
                    composed: true,
                  }),
                );
              } else {
                this.dispatchEvent(
                  new CustomEvent('add-tool-requested', {
                    detail: { groupHash: this._groupStore.groupDnaHash },
                    bubbles: false,
                    composed: true,
                  }),
                );
              }
            }}
              >
                <div class="flex- flex-1">
                  + ${this.numUnjoinedTools() && this.numUnjoinedTools()! > 0 ? msg('activate tools') : msg('add a tool')}
                </div>
              </button>
            </div>`
          : this.renderAppletButtons(this._groupApplets.value.value);
    }
  }

  renderHomeNotificationBadge() {
    const counts = this._groupNotifications.value;
    if (!counts) return html``;

    let urgency: string | undefined;
    let count: number | undefined;
    if (counts.high > 0) {
      urgency = 'high';
      count = counts.high;
    } else if (counts.medium > 0) {
      urgency = 'medium';
      count = counts.medium;
    } else if (counts.low > 0) {
      urgency = 'low';
      count = counts.low;
    }

    if (!urgency || urgency === 'low' || !count) return html``;

    return html`
      <div
        class="row center-content home-notification-dot ${this.collapsed ? 'home-notification-dot-collapsed' : ''}"
      >${count}</div>
    `;
  }

  renderGroupLogo() {
    switch (this._groupProfile.value.status) {
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
          ${this._groupProfile.value.value[0]?.icon_src
            ? html`<img
                class="icon ${this.collapsed ? 'icon-large' : ''}"
                .src=${this._groupProfile.value.value[0].icon_src}
                alt=${`${this._groupProfile.value.value[0].name} group icon`}
              />`
            : html`<div class="column center-content icon" style="background: gray;">?</div>`}
        `;
      case 'error':
        console.error('Failed to fetch group profile: ', this._groupProfile.value.error);
        return html`<display-error
          tooltip
          .headline=${msg('Error fetching the group profile')}
          .error=${this._groupProfile.value.error}
        ></display-error>`;
    }
  }

  groupName() {
    switch (this._groupProfile.value.status) {
      case 'pending':
        return msg('Loading...');
      case 'complete':
        return this._groupProfile.value.value[0]?.name
          ? this._groupProfile.value.value[0]?.name
          : 'unknown';
      case 'error':
        return 'ERROR';
    }
  }

  renderMyProfileAvatar() {
    switch (this._myProfile.value.status) {
      case 'pending':
        return html`<sl-skeleton
          style="height: var(--size, ${this.collapsed ? '35px' : '32px'}); width: var(--size, ${this
            .collapsed
            ? '35px'
            : '32px'}); --border-radius: 50%"
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
            : html` <holo-identicon
                .disableCopy=${true}
                .disableTooltip=${true}
                .hash=${this._groupStore.groupClient.myPubKey}
                .size=${32}
              >
              </holo-identicon>`}
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
    return this._onlinePeersCount.value;
  }

  renderPeersOnline() {
    const count = this.numPeersOnline();
    if (count === undefined) return html`??<span style="opacity: 0.3;">/??</span>`;
    const totalPeers = this.totalMembers() - 1;
    return html`${count}<span style="opacity: 0.3;">/${totalPeers}</span>`;
  }

  numUnjoinedTools(): number | undefined {
    if (this._unjoinedApplets.value.status !== 'complete') return undefined;
    const unjoinedAppletHashesB64 = Array.from(this._unjoinedApplets.value.value.keys()).map((h) =>
      encodeHashToBase64(h),
    );

    return unjoinedAppletHashesB64.filter((hB64) => !this._ignoredApplets.value.includes(hB64))
      .length;
  }

  hasInactiveTools(): boolean {
    return this.inactiveToolsDialog?.hasInactiveTools() ?? false;
  }

  renderInviteSection() {
    switch (this._groupProfile.value.status) {
      case 'pending':
        return msg('Loading...');
      case 'complete':
        const [groupProfile, modifiers] = this._groupProfile.value.value;
        if (!groupProfile) {
          return `Profile not found...`;
        }
        return html`
          <invite-people-dialog
            .groupProfile=${groupProfile}
            .modifiers=${modifiers}
          ></invite-people-dialog>

          ${this.amIPrivileged()
            ? html`
                <button
                  class="moss-button"
                  style="padding: 10px 0; margin: 40px 6px 6px 6px;"
                  variant="primary"
                  @click=${() => {
                this.inviteMemberDialog?.show();
              }}
                >
                  <div class="row center-content items-center;">
                    <div class="column" style="color: white;">${personPlusIcon(25)}</div>
                    <div style="font-size: 16px; margin-left: 5px;">${msg('Invite People')}</div>
                  </div>
                </button>
              `
            : html``}
        `;
      case 'error':
        return 'ERROR';
    }
  }

  renderUnjoinedAppletsButton() {
    // Don't show this button if there are no unjoined tools
    if (!this.numUnjoinedTools() || this.numUnjoinedTools() === 0) return html``;

    // Don't show this button if there are no activated tools yet
    // (in that case, the "No tools yet" pane handles it)
    if (this._groupApplets.value.status === 'complete' &&
        this._groupApplets.value.value.size === 0) {
      return html``;
    }

    return html`<sl-tooltip
      content="${msg('Activate tools peers already use')}"
      placement="right"
      hoist
    >
      <button
        class="btn activate-tools-button"
        @click=${() => {
        this.dispatchEvent(
          new CustomEvent('group-home-selected', {
            bubbles: false,
            composed: true,
          }),
        );
        this.dispatchEvent(
          new CustomEvent('unjoined-tools-clicked', {
            composed: true,
          }),
        );
      }}
      >
        ${this.collapsed
        ? html`<div
              class="column center-content "
              style="height: 35px; width: 35px; position: relative;"
            >
              <div class="column center-content unjoined-tools-indicator">
                ${this.numUnjoinedTools()}
              </div>
              ${downloadIcon()}
            </div>`
        : html`<div
              class="column center-content"
              style="height: 36px; opacity: 0.7; font-size: 13px;"
            >
              + ${this.numUnjoinedTools()} ${msg('more used by peers')}
            </div>`}
      </button>
    </sl-tooltip>`;
  }

  renderMemberProfile() {
    return html`
      <div class="column" style="margin-bottom: 40px;">
        <moss-profile-detail
          no-additional-fields
          .agentPubKey=${this._selectedAgent?.agent}
          style="margin-top: 40px;"
        ></moss-profile-detail>
        <div class="row items-center justify-center" style="margin-top: 9px;">
          <copy-hash
            .hash=${encodeHashToBase64(this._selectedAgent!.agent)}
            .tooltipText=${msg('click to copy public key')}
            shortened
          ></copy-hash>
          <sl-tooltip
            .content=${msg(
      "This is peer's public key. Use it to confirm the identity of the profile.",
    )}
          >
            <span style="margin-left:5px; opacity: 0.5;"
              >${questionMarkInfoIcon(20)}</span
            ></sl-tooltip
          >
        </div>
        <div class="row" style="align-items: center; margin-top: 20px;">
          <span style="font-weight: bold; margin-right: 10px;">${msg('Role:')}</span>
          <agent-permission .agent=${this._selectedAgent?.agent}></agent-permission>
        </div>
        <div class="row" style="align-items: center; margin-top: 15px;">
          <span style="font-weight: bold; margin-right: 10px;">${msg('Local Time:')}</span>
          ${this._selectedAgent?.tzUtcOffset
        ? html`<span
                >${localTimeFromUtcOffset(this._selectedAgent.tzUtcOffset)}
                (${relativeTzOffsetString(
          this._mossStore.tzUtcOffset(),
          this._selectedAgent.tzUtcOffset,
        )},
                ${UTCOffsetStringFromOffsetMinutes(this._selectedAgent.tzUtcOffset)})</span
              >`
        : html`<span>${msg('unknown')}</span>`}
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <inactive-tools-dialog
        @open-library-requested=${(e: CustomEvent) => {
        this.dispatchEvent(
          new CustomEvent('add-tool-requested', {
            detail: e.detail,
            bubbles: false,
            composed: true,
          }),
        );
      }}
      ></inactive-tools-dialog>
      ${!this.onlinePeersCollapsed
        ? ''
        : html`
            <moss-dialog
              width="670px"
              class="gradient"
              headerAlign="center"
              id="member-profile"
              noHeader=true
              style="position: relative;"
            >
              <div slot="content">
                ${this._selectedAgent ? this.renderMemberProfile() : ``}
              </div>
            </moss-dialog>
            <div class="column online-list" style="${this.collapsed ? 'left:60px' : ''}">
              <div class="row" style="position: absolute;right: 3px;">
                <button
                  class="btn"
                  @click=${() => (this.onlinePeersCollapsed = !this.onlinePeersCollapsed)}
                  style="margin-left: auto"
                >
                  ${closeIcon(18)}
                </button>
              </div>
              <group-peers-status
                @profile-selected=${(e) => {
            if (
              encodeHashToBase64(this._groupStore.groupClient.myPubKey) ===
              encodeHashToBase64(e.detail.agent)
            ) {
              this.dispatchEvent(
                new CustomEvent('my-profile-clicked', {
                  composed: true,
                }),
              );
            } else {
              this._selectedAgent = e.detail;
              this._memberProfileDialog.show();
            }
          }}
              ></group-peers-status>
              ${this.renderInviteSection()}
            </div>
          `}
      <div
        class="column flex-1 container invisible-scrollbars ${this.collapsed
        ? 'container-collapsed items-center'
        : ''}"
        style="margin-left: 2px;"
      >
        <!-- group home button -->
        <sl-tooltip content="${this.groupName()}" placement="right" hoist>
          <button
            class="btn ${!this.selectedAppletHash ? 'selected' : ''}"
            style="position: relative;"
            @click=${() => {
        this._groupStore.clearGroupNotificationStatus();
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
            ${this.renderHomeNotificationBadge()}
          </button>
        </sl-tooltip>

        <!-- Online Peers indicator -->
        <sl-tooltip
          content="${msg('Your Peers')}${this._onlinePeersCount.value !== undefined
        ? ` (${this.numPeersOnline()} ${msg('online')})`
        : ''}"
          placement="right"
          hoist
        >
          <button
            class="btn"
            @click=${() => (this.onlinePeersCollapsed = !this.onlinePeersCollapsed)}
          >
            ${this.collapsed
        ? html`<div class="column center-content" style="width: 35px;">
                  <div>${circleHalfIcon(12)}</div>
                  <div style="font-size: 16px;">${this.renderPeersOnline()}</div>
                </div>`
        : html`<div class="column" style="height: 35px;">
                  <div class="row items-center">
                    <div style="margin-right: 10px;">${circleHalfIcon(12)}</div>
                    ${this.renderPeersOnline()}&nbsp;${msg('online')}
                    <div style="margin-left: auto">
                      ${this.onlinePeersCollapsed
            ? html`${chevronSingleUpIcon(18)}`
            : html`${chevronSingleDownIcon(18)}`}
                    </div>
                  </div>
                </div>`}
          </button>
        </sl-tooltip>

        <div class="ruler ${this.collapsed ? 'short' : ''}" style="margin-top: 10px;"></div>

        <!-- Tool Buttons -->
        <div class="section-title" style="margin-bottom: 10px;">${msg('Tools')}</div>
        ${this.renderAppletButtonsLoading()}

        <!-- Unjoined Tools Button -->
        ${this.renderUnjoinedAppletsButton()}

        <!-- Add Tool Button - Hidden if no Tools are installed yet and the sidebar is expanded -->
        ${(this._groupApplets.value.status === 'complete' &&
        this._groupApplets.value.value.size === 0 &&
        !this.collapsed) ||
        !this.amIPrivileged()
        ? html``
        : html`<sl-tooltip hoist content="${msg('Add a new tool for the group')}" placement="bottom">
              <button
                class="${this.collapsed ? 'purple-btn-large' : 'purple-btn'}"
                @click=${async () => {
            // Check if there are inactive tools first
            if (this.hasInactiveTools()) {
              this.inactiveToolsDialog?.show();
            } else {
              // No inactive tools, proceed directly to library
              this.dispatchEvent(
                new CustomEvent('add-tool-requested', {
                  detail: { groupHash: this._groupStore.groupDnaHash },
                  bubbles: false,
                  composed: true,
                }),
              );
            }
          }}
              >
                <div class="column center-content">${plusIcon()}</div>
              </button>
            </sl-tooltip>`}
      </div>
      <!-- menu folding toggle -->
      <sl-tooltip content="${this.collapsed ? msg('Expand sidebar') : msg('Fold sidebar')}">
        <button
          class="menu-fold-toggle"
          @click=${() => {
        this._mossStore.setAppletSidebarCollapsed(!this.collapsed);
      }}
        >
          ${this.collapsed ? chevronDoubleRightIcon(18) : chevronDoubleLeftIcon(18)}
        </button>
      </sl-tooltip>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: flex;
        padding: 0 8px 0 4px;
        position: relative;
      }

      .container {
        width: 170px;
        max-width: 170px;
        position: relative;
        overflow-y: auto;
        overflow-x: hidden;
        height: calc(100vh - 32px);
      }

      .container-collapsed {
        width: 43px;
        max-width: 43px;
      }

      .ruler {
        height: 1px;
        background: var(--moss-dark-button);
        width: 170px;
        opacity: 0.2;
      }

      .short {
        width: 46px;
      }

      .section-title {
        font-size: 12px;
        color: var(--moss-dark-button);
        opacity: 0.7;
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
        border: 2px solid var(--moss-purple);
        padding: 2px;
      }

      .purple-btn {
        all: unset;
        padding: 4px;
        border-radius: 12px;
        margin: 2px 0;
        font-size: 16px;
        cursor: pointer;
        color: var(--moss-purple);
        min-height: 30px;
      }

      .purple-btn:focus-visible {
        border: 2px solid var(--moss-purple);
        padding: 2px;
      }

      .purple-btn:hover {
        background: #7461eb33;
      }

      .purple-btn-large {
        all: unset;
        margin: 2px 0;
        height: 32px;
        width: 32px;
        cursor: pointer;
        color: var(--moss-purple);
        border-radius: 8px;
        min-height: 28px;
        border: 2px solid transparent;
      }

      .purple-btn-large:focus-visible {
        border: 2px solid var(--moss-purple);
      }

      .purple-btn-large:hover {
        background: #7461eb33;
      }

      .activate-tools-button {
        background: var(--moss-light-green); border-radius: 12px;
        border: solid 1px transparent;
      }
      .activate-tools-button:hover {
        border: solid 1px #89D6AA;
      }

      .icon {
        height: 32px;
        width: 32px;
        border-radius: var(--border-radius, 50%);
      }

      .icon-large {
        height: 35px;
        width: 35px;
      }

      .selected {
        background: white;
      }

      .online-list {
        padding: 4px;
        position: absolute;
        top: 4px;
        left: 190px;
        width: 200px;
        background-color: white;
        border-radius: var(--border-radius, 8px);
        z-index: 10;
        min-height: 100px;
        max-height: calc(100vh - 50px);
        overflow-y: auto;
        overflow-x: hidden;
        border: solid 1px rgba(0, 0, 0, 0.2);
        scrollbar-width: thin;
      }

      .online-list::-webkit-scrollbar {
        width: 6px;
      }

      .online-list::-webkit-scrollbar-track {
        background: transparent;
      }

      .online-list::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.2);
        border-radius: 3px;
      }

      .online-list::-webkit-scrollbar-thumb:hover {
        background: rgba(0, 0, 0, 0.3);
      }

      .unjoined-tools-indicator {
        position: absolute;
        top: -3px;
        right: -4px;
        height: 14px;
        min-width: 18px;
        background: var(--moss-purple);
        color: white;
        font-size: 11px;
        font-weight: 600;
        border-radius: 4px;
      }

      .menu-fold-toggle {
        all: unset;
        cursor: pointer;
        position: absolute;
        bottom: 5px;
        right: 18px;
        opacity: 0.6;
      }

      .menu-fold-toggle:focus-visible {
        outline: 2px solid var(--moss-purple);
        border-radius: 4px;
      }

      .menu-fold-toggle:hover {
        opacity: 1;
      }

      .home-notification-dot {
        position: absolute;
        top: 0px;
        right: 0px;
        font-weight: bold;
        background: var(--moss-purple);
        border-radius: 4px;
        height: 16px;
        min-width: 10px;
        color: white;
        font-size: 12px;
        padding: 0 3px;
        z-index: 1;
      }

      .home-notification-dot-collapsed {
        top: -3px;
        right: -4px;
      }

      .dropzone {
        position: absolute;
        bottom: -10px;
        height: 20px;
        width: 42px;
        z-index: 1;
      }

      .dropzone-top {
        top: -8px;
        bottom: unset;
      }

      .dropzone-wide {
        width: 170px;
      }

      .dropzone-indicator {
        position: absolute;
        width: 42px;
        background: var(--moss-purple);
        height: 4px;
        border-radius: 2px;
        display: none;
      }

      .active .dropzone-indicator {
        display: block;
      }

      .dropzone-indicator-wide {
        width: 168px;
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

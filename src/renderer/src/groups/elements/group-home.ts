import { notify, notifyError, wrapPathInSvg } from '@holochain-open-dev/elements';
import { localized, msg } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import {
  ActionHash,
  AgentPubKey,
  DnaModifiers,
  EntryHash,
  HoloHash,
  decodeHashFromBase64,
  encodeHashToBase64,
} from '@holochain/client';
import {
  AsyncReadable,
  StoreSubscriber,
  Unsubscriber,
  joinAsync,
  pipe,
  toPromise,
} from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { AppletId, GroupProfile } from '@lightningrodlabs/we-applet';
import {
  mdiArrowLeft,
  mdiCog,
  mdiContentCopy,
  mdiHomeOutline,
  mdiLinkVariantPlus,
  mdiPowerPlugOffOutline,
} from '@mdi/js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import TimeAgo from 'javascript-time-ago';

import '@holochain-open-dev/profiles/dist/elements/profile-prompt.js';
import '@holochain-open-dev/profiles/dist/elements/agent-avatar.js';
import '@holochain-open-dev/profiles/dist/elements/profile-detail.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/tab-group/tab-group.js';
import '@shoelace-style/shoelace/dist/components/tab-panel/tab-panel.js';
import '@shoelace-style/shoelace/dist/components/tab/tab.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

import './group-peers-status.js';
import './group-applets.js';
import './group-applets-settings.js';
import './stewards-settings.js';
import './your-settings.js';
import './looking-for-peers.js';
import './edit-group-profile.js';
import '../../custom-views/elements/all-custom-views.js';
import './create-custom-group-view.js';
import './edit-custom-group-view.js';
import '../../elements/reusable/tab-group.js';
import './foyer-stream.js';
import './agent-permission.js';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { weStyles } from '../../shared-styles.js';
import { AppletAgent, AppletHash, DistributionInfo } from '../../types.js';
import { Applet } from '../../types.js';
import {
  UTCOffsetStringFromOffsetMinutes,
  appIdFromAppletHash,
  localTimeFromUtcOffset,
  markdownParseSafe,
  modifiersToInviteUrl,
  relativeTzOffsetString,
} from '../../utils.js';
import { dialogMessagebox } from '../../electron-api.js';
import { Tool, UpdateableEntity } from '../../personal-views/tool-library/types.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { AgentAndTzOffset } from './group-peers-status.js';

type View =
  | {
      view: 'main';
    }
  | { view: 'settings' }
  | { view: 'create-custom-view' }
  | {
      view: 'edit-custom-view';
      customViewHash: ActionHash;
    };

@localized()
@customElement('group-home')
export class GroupHome extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  permissionType = new StoreSubscriber(
    this,
    () => this.groupStore.permissionType,
    () => [this.groupStore],
  );

  _peersStatus = new StoreSubscriber(
    this,
    () => this.groupStore.peerStatuses(),
    () => [this.groupStore],
  );

  @query('#member-profile')
  _memberProfileDialog!: SlDialog;

  @state()
  _peerStatusLoading = true;

  @state()
  _recentlyJoined: Array<AppletId> = [];

  @state()
  _showIgnoredApplets = false;

  @state()
  _selectedTab: 'home' | 'unjoined tools' = 'home';

  @state()
  _editGroupDescription = false;

  @state()
  _loadingDescription = false;

  _unsubscribe: Unsubscriber | undefined;

  _groupDescription = new StoreSubscriber(
    this,
    () => this.groupStore.groupDescription,
    () => [this.groupStore],
  );

  _unjoinedApplets = new StoreSubscriber(
    this,
    () =>
      pipe(this.groupStore.unjoinedApplets, async (appletsAndKeys) =>
        Promise.all(
          Array.from(appletsAndKeys.entries()).map(
            async ([appletHash, [agentKey, timestamp, joinedMembers]]) => {
              let appletEntry: Applet | undefined;
              try {
                appletEntry = await toPromise(this.groupStore.applets.get(appletHash));
              } catch (e) {
                console.warn('@group-home @unjoined-applets: Failed to get appletEntry: ', e);
              }
              let toolsLibraryToolEntity: UpdateableEntity<Tool> | undefined;
              if (appletEntry) {
                const distributionInfo: DistributionInfo = JSON.parse(
                  appletEntry.distribution_info,
                );
                if (distributionInfo.type !== 'tools-library')
                  throw new Error(
                    "Cannot get unjoined applets from distribution types other than tools-library'",
                  );
                const toolBundleActionHash = decodeHashFromBase64(
                  distributionInfo.info.originalToolActionHash,
                );
                try {
                  toolsLibraryToolEntity = await toPromise(
                    this.mossStore.toolsLibraryStore.installableTools.get(toolBundleActionHash),
                  );
                } catch (e) {
                  console.warn('@group-home @unjoined-applets: Failed to get ToolEntity: ', e);
                }
              }
              return [
                appletHash,
                appletEntry,
                toolsLibraryToolEntity?.record.entry
                  ? toolsLibraryToolEntity.record.entry
                  : undefined,
                agentKey,
                timestamp,
                joinedMembers,
              ] as [
                AppletHash,
                Applet | undefined,
                Tool | undefined,
                AgentPubKey,
                number,
                AppletAgent[],
              ];
            },
          ),
        ),
      ),
    () => [this.groupStore, this.mossStore],
  );

  @state()
  view: View = { view: 'main' };

  @state()
  _joiningNewApplet: string | undefined;

  _peerStatusInterval: number | null | undefined;

  @state()
  _selectedAgent: AgentAndTzOffset | undefined;

  groupProfile = new StoreSubscriber(
    this,
    () => {
      const store = joinAsync([
        this.groupStore.groupProfile,
        this.groupStore.modifiers,
      ]) as AsyncReadable<[GroupProfile | undefined, DnaModifiers]>;
      // (window as any).groupProfileStore = store;
      return store;
    },
    () => [this.groupStore, this.mossStore],
  );

  async firstUpdated() {
    this._peerStatusInterval = window.setInterval(async () => {
      await this.groupStore.emitToAppletHosts({
        type: 'peer-status-update',
        payload: this._peersStatus.value ? this._peersStatus.value : {},
      });
    }, 5000);

    // const allGroupApplets = await this.groupStore.groupClient.getGroupApplets();
    setTimeout(() => {
      this._peerStatusLoading = false;
    }, 2500);
    await this.groupStore.groupDescription.reload();
  }

  disconnectedCallback(): void {
    if (this._unsubscribe) this._unsubscribe();
    if (this._peerStatusInterval) clearInterval(this._peerStatusInterval);
  }

  hasStewardPermission(): boolean {
    return (
      this.permissionType.value.status === 'complete' &&
      ['Progenitor', 'Steward'].includes(this.permissionType.value.value.type)
    );
  }

  async uninstallApplet(e: CustomEvent) {
    const confirmation = await dialogMessagebox({
      message:
        'WARNING: Uninstalling a Tool instance is permanent. You will not be able to re-join the same Applet instance at a later point and all your local data associated to that Applet instance will be deleted. Other group members can keep using the Applet instance normally.',
      type: 'warning',
      buttons: ['Cancel', 'Continue'],
    });
    if (confirmation.response === 0) return;
    try {
      const appletHash = e.detail;
      const appId = appIdFromAppletHash(appletHash);
      await window.electronAPI.uninstallApplet(appId);
      const groupsForApplet = await toPromise(this.mossStore.groupsForApplet.get(appletHash));
      await Promise.all(
        Array.from(groupsForApplet.values()).map((groupStore) =>
          groupStore.groupClient.abandonApplet(appletHash),
        ),
      );
      await this.mossStore.reloadManualStores();
    } catch (e) {
      console.error(`Failed to uninstall Applet instance: ${e}`);
      notifyError(msg('Failed to uninstall Applet instance.'));
    }
  }

  async joinNewApplet(appletHash: AppletHash) {
    this._joiningNewApplet = encodeHashToBase64(appletHash);
    try {
      await this.groupStore.installApplet(appletHash);
      this.dispatchEvent(
        new CustomEvent('applet-installed', {
          detail: {
            appletEntryHash: appletHash,
            groupDnaHash: this.groupStore.groupDnaHash,
          },
          composed: true,
          bubbles: true,
        }),
      );
      notify('Tool installed.');
      this._recentlyJoined.push(encodeHashToBase64(appletHash));
      this._showIgnoredApplets = false;
    } catch (e) {
      notifyError(`Failed to join Tool (See console for details).`);
      console.error(e);
    }
    this._joiningNewApplet = undefined;
  }

  ignoreApplet(appletHash: AppletHash) {
    const groupDnaHashB64 = encodeHashToBase64(this.groupStore.groupDnaHash);
    let ignoredApplets = this.mossStore.persistedStore.ignoredApplets.value(groupDnaHashB64);
    ignoredApplets.push(encodeHashToBase64(appletHash));
    // deduplicate ignored applets
    ignoredApplets = Array.from(new Set(ignoredApplets));
    this.mossStore.persistedStore.ignoredApplets.set(ignoredApplets, groupDnaHashB64);
    this.requestUpdate();
  }

  toggleIgnoredApplets() {
    const checkbox = this.shadowRoot!.getElementById(
      'show-ignored-applets-checkbox',
    ) as HTMLInputElement;
    this._showIgnoredApplets = checkbox.checked;
    this.requestUpdate();
  }

  unreadZaps(): number {
    return 2;
  }

  newAppletsAvailable(): number {
    if (this._unjoinedApplets.value.status === 'complete') {
      const ignoredApplets = this.mossStore.persistedStore.ignoredApplets.value(
        encodeHashToBase64(this.groupStore.groupDnaHash),
      );
      const filteredApplets = this._unjoinedApplets.value.value
        .filter(([appletHash, _]) => !this._recentlyJoined.includes(encodeHashToBase64(appletHash)))
        .map(([appletHash, appletEntry, toolBundle, agentKey, timestamp, joinedMembers]) => ({
          appletHash,
          appletEntry,
          toolBundle,
          agentKey,
          timestamp,
          joinedMembers,
          isIgnored: !!ignoredApplets && ignoredApplets.includes(encodeHashToBase64(appletHash)),
        }))
        .filter((info) => !!info.toolBundle) // applets who's AppEntry could has not yet been gossiped cannot be installed and should therefore not be shown
        .filter((info) => (info.isIgnored ? false : true));

      return filteredApplets.length;
    }
    return 0;
  }

  renderNewApplets() {
    switch (this._unjoinedApplets.value.status) {
      // TODO handle loading and error case nicely
      case 'pending':
        return html`<div class="column center-content">
          <sl-spinner style="font-size: 30px;"></sl-spinner>
        </div>`;
      case 'error':
        console.error('Failed to get unjoined applets: ', this._unjoinedApplets.value.error);
        return html`<div class="column center-content">
          <h3>Error: Failed to fetch unjoined Applets</h3>
          <span>${this._unjoinedApplets.value.error}</span>
        </div> `;
      case 'complete':
        const timeAgo = new TimeAgo('en-US');
        const ignoredApplets = this.mossStore.persistedStore.ignoredApplets.value(
          encodeHashToBase64(this.groupStore.groupDnaHash),
        );
        const filteredApplets = this._unjoinedApplets.value.value
          .filter(
            ([appletHash, _]) => !this._recentlyJoined.includes(encodeHashToBase64(appletHash)),
          )
          .map(([appletHash, appletEntry, toolBundle, agentKey, timestamp, joinedMembers]) => ({
            appletHash,
            appletEntry,
            toolBundle,
            agentKey,
            timestamp,
            joinedMembers,
            isIgnored: !!ignoredApplets && ignoredApplets.includes(encodeHashToBase64(appletHash)),
          }))
          .filter((info) => !!info.toolBundle) // applets who's AppEntry could has not yet been gossiped cannot be installed and should therefore not be shown
          .filter((info) => (info.isIgnored ? this._showIgnoredApplets : true))
          .sort((info_a, info_b) => info_b.timestamp - info_a.timestamp);

        return html` <div
            class="row"
            style="align-items: center; justify-content: flex-end; margin-top: -10px;"
          >
            <input
              @input=${() => this.toggleIgnoredApplets()}
              id="show-ignored-applets-checkbox"
              type="checkbox"
              .checked=${this._showIgnoredApplets}
            />
            <span>${msg('Show ignored Tools')}</span>
          </div>
          ${filteredApplets.length === 0
            ? html`
                <div class="column" style="flex: 1; align-items: center; margin-top: 50px;">
                  ${msg('No new Tools to install.')}
                </div>
              `
            : html`
                <div class="row" style="flex-wrap: wrap;">
                  ${filteredApplets.map(
                    (info) => html`
                      <sl-card class="applet-card">
                        <div class="column" style="flex: 1;">
                          <div class="card-header">
                            <div class="instance-details">
                              <agent-avatar
                                .size=${24}
                                style="margin-right: 5px;"
                                .agentPubKey=${info.agentKey}
                              ></agent-avatar>
                              <span>${msg('added an instance of ')}</span>
                              <span
                                style="margin-left: 5px; font-weight: bold; ${info.toolBundle?.title
                                  ? ''
                                  : 'opacity: 0.6;'}"
                                >${info.toolBundle ? info.toolBundle.title : 'unknown'}&nbsp;
                              </span>
                            </div>
                            <div
                              style="margin-bottom: 3px; text-align: right; opacity: 0.65; font-size: 12px;"
                            >
                              ${timeAgo.format(new Date(info.timestamp / 1000))}
                            </div>
                          </div>
                          <div class="card-content" style="align-items: center;">
                            <sl-tooltip
                              style="${info.toolBundle ? '' : 'display: none;'}"
                              content="${info.toolBundle?.subtitle}"
                            >
                              ${info.toolBundle?.icon
                                ? html`<img
                                    src=${info.toolBundle.icon}
                                    alt="Applet logo"
                                    style="height: 80px; margin-right: 10px;"
                                  />`
                                : html``}
                            </sl-tooltip>
                            <span style="font-weight: bold; font-size: 24px;"
                              >${info.appletEntry ? info.appletEntry.custom_name : 'unknown'}</span
                            >
                          </div>
                          <div class="card-footer" style="align-items: center; margin-top: 20px;">
                            <span style="margin-right: 5px;"><b>${msg('Participants ')}</b></span>
                            ${info.joinedMembers.map(
                              (appletAgent) => html`
                                <agent-avatar
                                  style="margin-left: 5px;"
                                  .agentPubKey=${appletAgent.group_pubkey}
                                ></agent-avatar>
                              `,
                            )}
                            <span style="display: flex; flex: 1;"></span>
                            <sl-button
                              style="margin-left: 20px;"
                              .loading=${this._joiningNewApplet ===
                              encodeHashToBase64(info.appletHash)}
                              .disabled=${!!this._joiningNewApplet}
                              variant="success"
                              @click=${() => this.joinNewApplet(info.appletHash)}
                              >${msg('Join')}</sl-button
                            >
                            ${info.isIgnored
                              ? html``
                              : html`
                                  <sl-button
                                    style="margin-left: 5px;"
                                    variant="warning"
                                    @click=${() => this.ignoreApplet(info.appletHash)}
                                    >${msg('Ignore')}</sl-button
                                  >
                                `}
                          </div>
                        </div>
                      </sl-card>
                    `,
                  )}
                </div>
              `}`;
      default:
        return html``;
    }
  }

  renderHomeContent() {
    switch (this._groupDescription.value.status) {
      case 'pending':
        return html` <div class="column center-content" style="flex: 1;">Loading...</div> `;
      case 'error':
        console.error(this._groupDescription.value.error);
        return html`
          <div class="column center-content" style="flex: 1;">
            Error. Failed to fetch group description.
          </div>
        `;
      case 'complete':
        if (this._editGroupDescription) {
          return html`
            <div class="row" style="justify-content: flex-end;">
              <button
                style="margin-right: 3px;"
                @click=${() => {
                  this._editGroupDescription = false;
                }}
              >
                ${msg('Cancel')}
              </button>
              <button
                @click=${async () => {
                  const descriptionInput = this.shadowRoot!.getElementById(
                    'group-description-input',
                  ) as HTMLTextAreaElement;
                  const myPermission = await toPromise(this.groupStore.permissionType);
                  if (!['Steward', 'Progenitor'].includes(myPermission.type)) {
                    this._editGroupDescription = false;
                    notifyError('No permission to edit group profile.');
                    return;
                  } else {
                    console.log('Saving decription...');
                    console.log('Value: ', descriptionInput.value);
                    const result = await this.groupStore.groupClient.setGroupMetaData({
                      permission_hash:
                        myPermission.type === 'Steward'
                          ? myPermission.content.permission_hash
                          : undefined,
                      name: 'description',
                      data: descriptionInput.value,
                    });
                    console.log('decription saved: ', result.entry);

                    await this.groupStore.groupDescription.reload();
                    this._editGroupDescription = false;
                  }
                }}
              >
                Save
              </button>
            </div>

            <sl-textarea
              id="group-description-input"
              size="large"
              rows="15"
              value=${this._groupDescription.value.value?.data}
            ></sl-textarea>
          `;
        }
        if (!this._groupDescription.value.value) {
          return html`
            <div class="column center-content" style="flex: 1;">
              No group description.
              <button
                style="margin-top: 10px;${this.hasStewardPermission() ? '' : 'display: none;'}"
                @click=${() => {
                  this._editGroupDescription = true;
                }}
              >
                Add Description
              </button>
            </div>
          `;
        } else {
          return html`
            <div class="column">
              <div class="row" style="justify-content: flex-end;">
                <button
                  style="${this.hasStewardPermission() ? '' : 'display: none;'}"
                  @click=${async () => {
                    this._loadingDescription = true;
                    // Reload group description in case another Steward has edited it in the meantime
                    try {
                      await this.groupStore.groupDescription.reload();
                    } catch (e) {
                      console.warn('Failed to load description: ', e);
                    }
                    this._loadingDescription = false;
                    this._editGroupDescription = true;
                  }}
                  ?disabled=${this._loadingDescription}
                >
                  ${this._loadingDescription ? '...' : msg('Edit Description')}
                </button>
              </div>
            </div>
            <div>${unsafeHTML(markdownParseSafe(this._groupDescription.value.value.data))}</div>
          `;
        }
    }
  }

  renderFoyer() {
    return html`
      <div class="foyer-panel" style="display: flex; flex: 1;">
        <foyer-stream style="display: flex; flex: 1;"></foyer-stream>
      </div>
    `;
  }

  renderMainPanelContent() {
    switch (this._selectedTab) {
      case 'home':
        return html`
          <div style="display:flex; flex: 1; overflow-y: hidden;">
            <div class="flex-scrollable-parent" style="flex:3">
              <div class="flex-scrollable-container">
                <div class="flex-scrollable-y">
                  <div class="home-panel">${this.renderHomeContent()}</div>
                </div>
              </div>
            </div>
            <div style="display: flex; flex: 1">${this.renderFoyer()}</div>
          </div>
        `;
      case 'unjoined tools':
        return html` <div style="padding: 20px;">${this.renderNewApplets()}</div> `;
    }
  }

  renderHashForCopying(text: string, hash: HoloHash) {
    const hashB64 = encodeHashToBase64(hash);
    const hashText = hashB64.slice(0, 8) + '...' + hashB64.slice(-8);
    return html`
      <span
        @click=${async () => {
          await navigator.clipboard.writeText(hashB64);
          notify(msg('Hash copied to clipboard.'));
        }}
        title=${hashB64}
        class="copyable-hash"
        >${msg(text)}: ${hashText}</span
      >
    `;
  }

  renderMemberProfile() {
    return html`
      <div class="column">
        <profile-detail .agentPubKey=${this._selectedAgent?.agent}></profile-detail>
        <div class="row" style="align-items: center; margin-top: 20px;">
          <span style="font-size: 14px; font-weight: bold; margin-right: 10px;">Role:</span>
          <agent-permission .agent=${this._selectedAgent?.agent}></agent-permission>
        </div>
        <div class="row" style="align-items: center; margin-top: 15px;">
          <span style="font-size: 14px; font-weight: bold; margin-right: 10px;">Local Time:</span>
          ${this._selectedAgent?.tzUtcOffset
            ? html`<span
                >${localTimeFromUtcOffset(this._selectedAgent.tzUtcOffset)}
                (${relativeTzOffsetString(
                  this.mossStore.tzUtcOffset(),
                  this._selectedAgent.tzUtcOffset,
                )},
                ${UTCOffsetStringFromOffsetMinutes(this._selectedAgent.tzUtcOffset)})</span
              >`
            : html`<span>unknown</span>`}
        </div>
        <span style="font-size: 13px; font-weight: bold; margin-top: 40px;">Public key:</span>
        <div
          class="row pubkey-copy"
          style="align-items: center;"
          @click=${async () => {
            await navigator.clipboard.writeText(encodeHashToBase64(this._selectedAgent!.agent));
            notify(msg('Hash Copied to clipboard.'));
          }}
        >
          <span style="margin-right: 5px;">${encodeHashToBase64(this._selectedAgent!.agent)}</span>
          <sl-icon .src=${wrapPathInSvg(mdiContentCopy)}></sl-icon>
        </div>
      </div>
    `;
  }

  renderMain(groupProfile: GroupProfile, modifiers: DnaModifiers) {
    const invitationUrl = modifiersToInviteUrl(modifiers);
    return html`
      <div class="row" style="flex: 1; max-height: calc(100vh - 74px);">
        <div
          class="column"
          style="flex: 1; padding: 16px 16px 0 0; overflow-y: auto; position: relative;"
        >
          <div class="column" style="color: white; position: absolute; bottom: 6px; left: 23px;">
            ${this.renderHashForCopying('Group DNA Hash', this.groupStore.groupDnaHash)}
            ${this.renderHashForCopying('Your Public Key', this.groupStore.groupClient.myPubKey)}
          </div>

          <div
            style=" background-image: url(${groupProfile.icon_src}); background-size: cover; filter: blur(10px); position: absolute; top: 0; bottom: 0; left: 0; right: 0; opacity: 0.2; z-index: -1;"
          ></div>

          <!-- Top Row -->

          <div class="row" style="align-items: center; margin-bottom: 24px">
            <div class="row" style="align-items: center; flex: 1;">
              <div
                style="background: linear-gradient(rgb(178, 200, 90) 0%, rgb(102, 157, 90) 62.38%, rgb(127, 111, 82) 92.41%); width: 64px; height: 64px; border-radius: 50%; margin-right: 20px;"
              >
                <img
                  .src=${groupProfile.icon_src}
                  style="height: 64px; width: 64px; margin-right: 16px; border-radius: 50%;"
                  alt="${groupProfile.name}"
                />
              </div>
              <span class="title">${groupProfile.name}</span>
            </div>

            <div
              class="row settings-btn"
              style="align-items: center;"
              tabindex="0"
              @click=${() => {
                this.view = { view: 'settings' };
              }}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  this.view = { view: 'settings' };
                }
              }}
            >
              <div style="font-weight: bold; margin-right: 3px; font-size: 18px;">
                ${msg('Settings')}
              </div>
              <div style="position: relative;">
                <sl-icon .src=${wrapPathInSvg(mdiCog)} style="font-size: 2rem;"></sl-icon>
              </div>
            </div>
          </div>

          <!-- NEW APPLETS -->
          <div class="row tab-section">
            <div
              tabindex="0"
              class="row tab ${this._selectedTab === 'home' ? 'tab-selected' : ''}"
              @click=${() => {
                this._selectedTab = 'home';
              }}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') this._selectedTab = 'home';
              }}
            >
              <sl-icon
                style="margin-left: -10px; font-size: 1.8rem;"
                .src=${wrapPathInSvg(mdiHomeOutline)}
              ></sl-icon>
              <span style="margin-left: 5px;">${msg('Home')}</span>
            </div>
            <div
              tabindex="0"
              class="row tab ${this._selectedTab === 'unjoined tools' ? 'tab-selected' : ''}"
              style="position: relative;"
              @click=${() => {
                this._selectedTab = 'unjoined tools';
              }}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') this._selectedTab = 'unjoined tools';
              }}
            >
              ${this.newAppletsAvailable()
                ? html`<div
                    class="row center-content indicator ${this.newAppletsAvailable() > 9
                      ? 'padded'
                      : ''}"
                  >
                    ${this.newAppletsAvailable()}
                  </div>`
                : html``}
              ${msg('Unjoined Tools')}
            </div>
          </div>
          <div class="column main-panel">${this.renderMainPanelContent()}</div>
        </div>

        <div class="column online-status-bar">
          <div class="flex-scrollable-parent">
            <div class="flex-scrollable-container">
              <div class="flex-scrollable-y">
                ${this._peerStatusLoading
                  ? html`<div
                      class="column center-content"
                      style="margin-top: 20px; font-size: 20px;"
                    >
                      <sl-spinner></sl-spinner>
                    </div>`
                  : html``}
                <group-peers-status
                  style="${this._peerStatusLoading ? 'display: none;' : ''}"
                  @profile-selected=${(e) => {
                    this._selectedAgent = e.detail;
                    this._memberProfileDialog.show();
                  }}
                ></group-peers-status>
              </div>
            </div>
          </div>

          <sl-dialog id="invite-member-dialog" .label=${msg('Invite New Member')}>
            <div class="column">
              <span>${msg('To invite other people to join this group, send them this link:')}</span>

              <div class="row" style="margin-top: 16px">
                <sl-input value=${invitationUrl} style="margin-right: 8px; flex: 1"> </sl-input>
                <sl-button
                  variant="primary"
                  @click=${async () => {
                    await navigator.clipboard.writeText(invitationUrl);
                    notify(msg('Invite link copied to clipboard.'));
                  }}
                  >${msg('Copy')}</sl-button
                >
              </div>
            </div>
          </sl-dialog>

          <sl-button
            class="invite-btn"
            variant="primary"
            @click=${() => {
              (this.shadowRoot?.getElementById('invite-member-dialog') as SlDialog).show();
            }}
          >
            <div class="row center-content">
              <sl-icon
                .src=${wrapPathInSvg(mdiLinkVariantPlus)}
                style="color: white; height: 25px; width: 25px; margin-right: 12px; "
              ></sl-icon>
              <div style="font-size: 16px; margin-top: 4px;">${msg('Invite Member')}</div>
            </div>
          </sl-button>
        </div>
      </div>
    `;
  }

  renderCreateCustomView() {
    return html`<div class="column" style="flex: 1">
      <create-custom-group-view
        style="flex: 1"
        @create-cancelled=${() => {
          this.view = { view: 'main' };
        }}
        @custom-view-created=${() => {
          this.view = { view: 'main' };
        }}
      ></create-custom-group-view>
    </div>`;
  }

  renderEditCustomView(customViewHash: EntryHash) {
    return html`<div class="column" style="flex: 1">
      <edit-custom-group-view
        .customViewHash=${customViewHash}
        style="flex: 1"
        @edit-cancelled=${() => {
          this.view = { view: 'main' };
        }}
        @custom-view-updated=${() => {
          this.view = { view: 'main' };
        }}
      ></edit-custom-group-view>
    </div>`;
  }

  renderNewSettings() {
    const tabs = [
      [
        'Tools',
        html`<group-applets-settings
          @uninstall-applet=${async (e) => this.uninstallApplet(e)}
          @applets-disabled=${(e) => {
            this.dispatchEvent(
              new CustomEvent('applets-disabled', {
                detail: e.detail,
                bubbles: true,
                composed: true,
              }),
            );
          }}
          style="display: flex; flex: 1;"
        ></group-applets-settings>`,
      ],
      [
        'Custom Views',
        html`
          <div class="column center-content" style="flex: 1;">
            <span class="placeholder" style="margin-top: 200px;"
              >${msg(
                'You can add custom views to this group, combining the relevant blocks from each applet.',
              )}</span
            >
            <all-custom-views
              style="margin-top: 8px; flex: 1;"
              @edit-custom-view=${(e) => {
                this.view = {
                  view: 'edit-custom-view',
                  customViewHash: e.detail.customViewHash,
                };
              }}
            ></all-custom-views>
            <div class="row" style="flex: 1">
              <span style="flex: 1"></span>
              <sl-button
                variant="primary"
                @click=${() => {
                  this.view = { view: 'create-custom-view' };
                }}
                >${msg('Create Custom View')}</sl-button
              >
            </div>
          </div>
        `,
      ],
      [
        'Your Settings',
        html`
          <div class="column center-content" style="flex: 1;">
            <your-settings
              @group-left=${(e) =>
                this.dispatchEvent(
                  new CustomEvent('group-left', {
                    detail: {
                      groupDnaHash: e.detail.groupDnaHash,
                    },
                    bubbles: true,
                    composed: true,
                  }),
                )}
            ></your-settings>
          </div>
        `,
      ],
    ];

    if (this.permissionType.value.status === 'complete') {
      if (['Progenitor', 'Steward'].includes(this.permissionType.value.value.type)) {
        tabs.splice(2, 0, [
          'Group Stewards',
          html`<stewards-settings style="display: flex; flex: 1;"></stewards-settings>`,
        ]);
        tabs.push([
          'Group Profile',
          html`
            <div class="column center-content" style="flex: 1;">
              <edit-group-profile
                style="background: white; padding: 20px; border-radius: 10px;"
              ></edit-group-profile>
            </div>
          `,
        ]);
      }
    }

    return html`
      <div class="column" style="flex: 1; position: relative;">
        <div
          class="row"
          style="height: 68px; align-items: center; background: var(--sl-color-primary-200)"
        >
          <sl-icon-button
            .src=${wrapPathInSvg(mdiArrowLeft)}
            @click=${() => {
              this.view = { view: 'main' };
            }}
            style="margin-left: 20px; font-size: 30px;"
          ></sl-icon-button>
          <span style="display: flex; flex: 1;"></span>
          <span class="title" style="margin-right: 20px; font-weight: bold;"
            >${msg('Group Settings')}</span
          >
        </div>

        <tab-group .tabs=${tabs} style="display: flex; flex: 1;"> </tab-group>

        <sl-button
          variant="warning"
          style="position: absolute; bottom: 10px; right: 10px;"
          @click=${async () => {
            this.dispatchEvent(
              new CustomEvent('disable-group', {
                detail: this.groupStore.groupDnaHash,
                bubbles: true,
                composed: true,
              }),
            );
          }}
        >
          <div class="row" style="align-items: center;">
            <sl-icon
              style="margin-right: 5px; font-size: 1.3rem;"
              .src=${wrapPathInSvg(mdiPowerPlugOffOutline)}
            ></sl-icon>
            <div>${msg('Disable group')}</div>
          </div></sl-button
        >
      </div>
    `;
  }

  renderContent(groupProfile: GroupProfile, modifiers: DnaModifiers) {
    switch (this.view.view) {
      case 'main':
        return this.renderMain(groupProfile, modifiers);
      case 'settings':
        return this.renderNewSettings();
      case 'create-custom-view':
        return this.renderCreateCustomView();
      case 'edit-custom-view':
        return this.renderEditCustomView(this.view.customViewHash);
    }
  }

  render() {
    switch (this.groupProfile.value.status) {
      case 'pending':
        return html`<div class="row center-content" style="flex: 1">
          <sl-spinner style="font-size: 2rem"></sl-spinner>
        </div>`;
      case 'complete':
        const groupProfile = this.groupProfile.value.value[0];
        const modifiers = this.groupProfile.value.value[1];

        if (!groupProfile)
          return html`<looking-for-peers style="display: flex; flex: 1;"></looking-for-peers>`;

        return html`
          <sl-dialog no-header id="member-profile">
            ${this._selectedAgent ? this.renderMemberProfile() : ``}
          </sl-dialog>
          <profile-prompt
            ><span slot="hero" style="max-width: 500px; margin-bottom: 32px" class="placeholder"
              >${msg(
                'Create your personal profile for this group. Only members of this group will be able to see your profile.',
              )}</span
            >
            ${this.renderContent(groupProfile, modifiers)}
          </profile-prompt>
        `;
      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching the group information')}
          .error=${this.groupProfile.value.error}
        ></display-error>`;
    }
  }

  static styles = [
    weStyles,
    css`
      :host {
        display: flex;
        /* background: var(--sl-color-secondary-0); */
        background-color: #588121;
        padding: 8px;
        border-radius: 5px 0 0 0;
      }

      .settings-btn {
        color: white;
        cursor: pointer;
      }

      .settings-btn:hover {
        color: var(--sl-color-tertiary-200);
      }

      .settings-btn:active {
        color: var(--sl-color-tertiary-300);
      }

      .card-header {
        width: 100%;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .instance-details {
        display: flex;
        font-size: 12px;
        align-items: center;
      }

      .card-content {
        display: flex;
        align-items: center;
        padding-top: 15px;
        justify-content: center;
      }

      .card-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      sl-tab-panel::part(base) {
        width: 600px;
      }
      sl-tab-panel[active] {
        display: flex;
        justify-content: center;
      }
      .title {
        font-size: 25px;
        font-weight: bold;
        color: #fff;
      }
      .subtitle {
        font-size: 18px;
        font-weight: bold;
        color: #fff;
      }
      .invite-btn::part(base) {
        background-color: #69982c;
        border-color: #69982c;
      }
      .applet-card {
        width: 100%;
        margin: 10px;
        color: black;
        --border-radius: 15px;
        border: none;
        --border-color: none;
        --sl-panel-background-color: #fbffe7;
      }

      .tab-section {
        height: 50px;
        align-items: center;
      }

      .tab {
        font-size: 1.25rem;
        align-items: center;
        justify-content: center;
        color: white;
        height: 50px;
        width: 180px;
        box-shadow: 1px 1px 6px 0px #223607;
        border-radius: 5px 5px 0 0;
        /* background: linear-gradient(0, #142919c1 0%, #1e3b25b3 50.91%); */
        background: #1e3b2585;
        cursor: pointer;
        clip-path: inset(-20px -20px 0 -20px);
      }

      .tab:hover {
        /* background: #335c21; */
        /* background: #e1efda; */
        background: #1e3b25;
      }

      .tab-selected {
        /* background: #335c21; */
        /* background: #e1efda; */
        background: #1e3b25;
      }

      .main-panel {
        flex: 1;
        /* background: #335c21; */
        /* background: #e1efda; */
        background: #1e3b25;
        color: white;
        border-radius: 0 5px 5px 5px;
        box-shadow: 1px 1px 3px 0px #223607;
        box-shadow: 1px 1px 6px 0px #223607;
        overflow-y: auto;
      }

      .main-panel a {
        color: #07cd07;
      }

      .home-panel {
        padding: 20px;
      }

      #group-description-input {
        margin-top: 5px;
      }

      .foyer-panel {
        /* border-left: solid 1px white; */
        padding-left: 5px;
        background: #08230e;
      }

      .online-status-bar {
        color: var(--sl-color-secondary-100);
        width: 230px;
        padding: 16px;
        /* background: #3a5b0c; */
        /* background: #335c21; */
        background: #1e3b25;
        border-radius: 5px;
        box-shadow: 1px 1px 6px 0px #223607;
      }

      .indicator {
        position: absolute;
        text-align: center;
        color: black;
        font-weight: bold;
        font-size: 1.05rem;
        top: 7px;
        right: 9px;
        min-width: 20px;
        height: 20px;
        border-radius: 10px;
        background: #fcee2d;
      }

      .padded {
        padding: 0 4px;
      }
      .copyable-hash {
        cursor: pointer;
      }

      .pubkey-copy {
        font-size: 13px;
        cursor: pointer;
        padding: 9px 5px;
        background: #ffffff;
        border-radius: 5px;
        justify-content: center;
        margin: 2px 0;
      }

      sl-dialog {
        color: black;
        --sl-panel-background-color: var(--sl-color-primary-0);
      }
    `,
  ];
}

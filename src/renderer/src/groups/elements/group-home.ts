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
import { AppletHash, AppletId, GroupProfile } from '@theweave/api';
import { mdiCog, mdiHomeOutline } from '@mdi/js';
import TimeAgo from 'javascript-time-ago';
import { Value } from '@sinclair/typebox/value';

import '@holochain-open-dev/profiles/dist/elements/agent-avatar.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/tab-group/tab-group.js';
import '@shoelace-style/shoelace/dist/components/tab/tab.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';

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
import '../../elements/_new_design/group-settings.js';
import '../../elements/_new_design/moss-dialog.js';
import '../../elements/_new_design/profile/moss-profile-detail.js';
import '../../elements/_new_design/copy-hash.js';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { mossStyles } from '../../shared-styles.js';
import { DistributionInfo, TDistributionInfo, ToolInfoAndVersions } from '@theweave/moss-types';
import { Applet, AppletAgent } from '../../../../../shared/group-client/dist/index.js';
import { markdownParseSafe } from '../../utils.js';
import { dialogMessagebox } from '../../electron-api.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { appIdFromAppletHash } from '@theweave/utils';
import { GroupSettings } from '../../elements/_new_design/group-settings.js';
import { MossDialog } from '../../elements/_new_design/moss-dialog.js';

type View =
  | {
    view: 'main';
  }
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
  private _groupStore!: GroupStore;

  permissionType = new StoreSubscriber(
    this,
    () => this._groupStore.permissionType,
    () => [this._groupStore],
  );

  _peersStatus = new StoreSubscriber(
    this,
    () => this._groupStore.peerStatuses(),
    () => [this._groupStore],
  );

  private _ignoredApplets = new StoreSubscriber(
    this,
    () => this._groupStore.ignoredApplets(),
    () => [this._groupStore],
  );

  @query('#group-settings-dialog')
  groupSettingsDialog: MossDialog | undefined;

  @query('#group-settings')
  groupSettings: GroupSettings | undefined;

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
    () => this._groupStore.groupDescription,
    () => [this._groupStore],
  );

  _unjoinedApplets = new StoreSubscriber(
    this,
    () =>
      pipe(this._groupStore.unjoinedApplets, async (appletsAndKeys) =>
        Promise.all(
          Array.from(appletsAndKeys.entries()).map(
            async ([appletHash, [agentKey, timestamp, joinedMembers]]) => {
              let appletEntry: Applet | undefined;
              try {
                appletEntry = await toPromise(this._groupStore.applets.get(appletHash));
              } catch (e) {
                console.warn('@group-home @unjoined-applets: Failed to get appletEntry: ', e);
              }
              let toolInfoAndVersions: ToolInfoAndVersions | undefined;
              if (appletEntry) {
                const distributionInfo: DistributionInfo = JSON.parse(
                  appletEntry.distribution_info,
                );
                Value.Assert(TDistributionInfo, distributionInfo);
                if (distributionInfo.type === 'web2-tool-list') {
                  toolInfoAndVersions = await this.mossStore.toolInfoFromRemote(
                    distributionInfo.info.toolListUrl,
                    distributionInfo.info.toolId,
                    distributionInfo.info.versionBranch,
                  );
                }
              }
              return [
                appletHash,
                appletEntry,
                toolInfoAndVersions,
                agentKey,
                timestamp,
                joinedMembers,
              ] as [
                  AppletHash,
                  Applet | undefined,
                  ToolInfoAndVersions | undefined,
                  AgentPubKey,
                  number,
                  AppletAgent[],
                ];
            },
          ),
        ),
      ),
    () => [this._groupStore, this.mossStore],
  );

  @state()
  view: View = { view: 'main' };

  @state()
  _joiningNewApplet: string | undefined;

  _peerStatusInterval: number | null | undefined;

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

  async firstUpdated() {
    await this._groupStore.groupDescription.reload();
  }

  disconnectedCallback(): void {
    if (this._unsubscribe) this._unsubscribe();
    if (this._peerStatusInterval) clearInterval(this._peerStatusInterval);
  }

  public selectTab(tab: 'home' | 'unjoined tools'): void {
    this._selectedTab = tab;
  }

  public openInactiveTools() {
    this.groupSettingsDialog?.show();
    this.groupSettings?.showInactiveTools();
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
        'WARNING: Uninstalling a Tool instance is permanent. You will not be able to re-join the same Tool instance at a later point and all your local data associated to that Tool instance will be deleted. Other group members can keep using the Tool instance normally.',
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
      console.error(`Failed to uninstall tool instance: ${e}`);
      notifyError(msg('Failed to uninstall tool instance.'));
    }
  }

  async joinNewApplet(appletHash: AppletHash) {
    this._joiningNewApplet = encodeHashToBase64(appletHash);
    try {
      await this._groupStore.installApplet(appletHash);
      this.dispatchEvent(
        new CustomEvent('applet-installed', {
          detail: {
            appletEntryHash: appletHash,
            groupDnaHash: this._groupStore.groupDnaHash,
          },
          composed: true,
          bubbles: true,
        }),
      );
      notify('Tool installed.');
      this._recentlyJoined.push(encodeHashToBase64(appletHash));
      this._showIgnoredApplets = false;
    } catch (e) {
      notifyError(`Failed to activate Tool (See console for details).`);
      console.error(e);
    }
    this._joiningNewApplet = undefined;
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
      const ignoredApplets = this._ignoredApplets.value;
      const filteredApplets = this._unjoinedApplets.value.value
        .filter(([appletHash, _]) => !this._recentlyJoined.includes(encodeHashToBase64(appletHash)))
        .map(([appletHash, appletEntry, agentKey, timestamp, joinedMembers]) => ({
          appletHash,
          appletEntry,
          agentKey,
          timestamp,
          joinedMembers,
          isIgnored: !!ignoredApplets && ignoredApplets.includes(encodeHashToBase64(appletHash)),
        }))
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
          encodeHashToBase64(this._groupStore.groupDnaHash),
        );
        const filteredApplets = this._unjoinedApplets.value.value
          .filter(
            ([appletHash, _]) => !this._recentlyJoined.includes(encodeHashToBase64(appletHash)),
          )
          .map(
            ([
              appletHash,
              appletEntry,
              toolInfoAndVersions,
              agentKey,
              timestamp,
              joinedMembers,
            ]) => ({
              appletHash,
              appletEntry,
              toolInfoAndVersions,
              agentKey,
              timestamp,
              joinedMembers,
              isIgnored:
                !!ignoredApplets && ignoredApplets.includes(encodeHashToBase64(appletHash)),
            }),
          )
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
                  ${msg('No new Tools to activate.')}
                </div>
              `
            : html`
                <div class="row" style="flex-wrap: wrap; max-height: calc(100vh - 207px); overflow-y: auto;">
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
                                style="margin-left: 5px; font-weight: bold; ${info
                  .toolInfoAndVersions?.title
                  ? ''
                  : 'opacity: 0.6;'}"
                                >${info.toolInfoAndVersions
                  ? info.toolInfoAndVersions.title
                  : 'unknown'}&nbsp;
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
                              style="${info.toolInfoAndVersions ? '' : 'display: none;'}"
                              content="${info.toolInfoAndVersions?.subtitle}"
                            >
                              ${info.toolInfoAndVersions?.icon
                  ? html`<img
                                    src=${info.toolInfoAndVersions.icon}
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
                              >${msg('Activate')}</sl-button
                            >
                            ${info.isIgnored
                  ? html``
                  : html`
                                  <sl-button
                                    style="margin-left: 5px;"
                                    variant="warning"
                                    @click=${() => this._groupStore.ignoreApplet(info.appletHash)}
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
              const myPermission = await toPromise(this._groupStore.permissionType);
              if (!['Steward', 'Progenitor'].includes(myPermission.type)) {
                this._editGroupDescription = false;
                notifyError('No permission to edit group profile.');
                return;
              } else {
                console.log('Saving decription...');
                console.log('Value: ', descriptionInput.value);
                const result = await this._groupStore.groupClient.setGroupDescription(
                  myPermission.type === 'Steward'
                    ? myPermission.content.permission_hash
                    : undefined,
                  descriptionInput.value,
                );

                console.log('decription saved: ', result.entry);

                await this._groupStore.groupDescription.reload();
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
            <div class="column center-content" style="flex: 1; padding: 40px 0;">
              No group description.
              <button
                class="moss-button"
                style="margin-top: 30px; padding-top: 10px; padding-bottom: 10px;${this.hasStewardPermission()
              ? ''
              : 'display: none;'}"
                @click=${() => {
              this._editGroupDescription = true;
            }}
              >
                + Add Description
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
                await this._groupStore.groupDescription.reload();
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
            <div class="group-description">
              ${unsafeHTML(markdownParseSafe(this._groupDescription.value.value.data))}
            </div>
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

  renderMain(groupProfile: GroupProfile) {
    return html`
      <moss-dialog id="group-settings-dialog">
        <span slot="header"> ${msg('Group Settings')}</span>
        <group-settings slot="content"
            id="group-settings"
            @uninstall-applet=${async (e) => this.uninstallApplet(e)}
        ></group-settings>

      </moss-dialog>
  
      <div class="row" style="flex: 1;">
        <div
          class="column"
          style="flex: 1; padding: 16px 16px 0 0; overflow-y: auto; position: relative;"
        >
          <!-- <div
            style=" background-image: url(${groupProfile.icon_src}); background-size: cover; filter: blur(10px); position: absolute; top: 0; bottom: 0; left: 0; right: 0; opacity: 0.2; z-index: -1;"
          ></div> -->

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
              class="row settings-btn items-center"
              tabindex="0"
              @click=${() => {
        this.groupSettingsDialog?.show();
      }}
              @keypress=${(e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          this.groupSettingsDialog?.show();
        }
      }}
            >
              <div
                style="font-weight: bold; margin-right: 3px; font-size: 18px; margin-bottom: 5px;"
              >
                ${msg('Settings')}
              </div>
              <div style="position: relative;">
                <sl-icon .src=${wrapPathInSvg(mdiCog)} style="font-size: 2rem;"></sl-icon>
              </div>
            </div>
          </div>

          <!-- NEW APPLETS -->
          <div class="row tab-bar ">
            <div
              tabindex="0"
              class="tab ${this._selectedTab === 'home' ? 'tab-selected' : ''}"
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
              ${msg('Unactivated Tools')}
            </div>
          </div>
          <div class="column main-panel">${this.renderMainPanelContent()}</div>
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

  renderContentInner(groupProfile: GroupProfile, _: DnaModifiers) {
    switch (this.view.view) {
      case 'main':
        return this.renderMain(groupProfile);
      case 'create-custom-view':
        return this.renderCreateCustomView();
      case 'edit-custom-view':
        return this.renderEditCustomView(this.view.customViewHash);
    }
  }

  renderContent() {
    switch (this.groupProfile.value.status) {
      case 'pending':
        return html`<div class="row center-content" style="flex: 1">
          <img src="loading_animation.svg" />
        </div>`;
      case 'complete':
        const groupProfile = this.groupProfile.value.value[0];
        const modifiers = this.groupProfile.value.value[1];

        if (!groupProfile)
          return html`<looking-for-peers style="display: flex; flex: 1;"></looking-for-peers>`;

        return html`
          <moss-profile-prompt>
            ${this.renderContentInner(groupProfile, modifiers)}
          </moss-profile-prompt>
        `;
      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching the group information')}
          .error=${this.groupProfile.value.error}
        ></display-error>`;
    }
  }

  render() {
    return html` ${this.renderContent()} `;
  }

  static styles = [
    mossStyles,
    css`
      .settings-btn {
        color: white;
        cursor: pointer;
      }

      .settings-btn:hover {
        color: var(--moss-dark-green);
      }

      .settings-btn:active {
        color: var(--moss-dark-green);
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
      .title {
        font-size: 25px;
        font-weight: bold;
        color: black;
      }
      .subtitle {
        font-size: 18px;
        font-weight: bold;
        color: #fff;
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

      .main-panel {
        flex: 1;
        /* background: var(--moss-fishy-green); */
        background: var(--moss-fishy-green);
        color: black;
        border-radius: 0 5px 5px 5px;
        /* box-shadow: 1px 1px 6px 0px var(--moss-fishy-green); */
        overflow-y: auto;
        z-index: 1;
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
        color: black;
        padding-left: 5px;
        background: #d4dfcf;
      }

      .indicator {
        position: absolute;
        text-align: center;
        color: white;
        font-weight: bold;
        font-size: 1rem;
        top: 4px;
        right: 4px;
        min-width: 16px;
        height: 16px;
        border-radius: 4px;
        background: var(--moss-purple);
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

      .copy-link-input::part(input) {
        cursor: default;
      }

      /* backdrop should only cover group section, not sidebar */
      /* .moss-dialog::part(overlay) {
        top: 74px;
        left: 74px;
      } */

      .group-description a {
        color: var(--moss-purple);
      }

      .group-description a:hover {
        color: var(--moss-purple-semi-transparent);
      }
    `,
  ];
}

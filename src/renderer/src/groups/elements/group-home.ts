import { notify, notifyError, wrapPathInSvg } from '@holochain-open-dev/elements';
import { localized, msg } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  ActionHash,
  AgentPubKey,
  EntryHash,
  decodeHashFromBase64,
  encodeHashToBase64,
} from '@holochain/client';
import {
  AsyncReadable,
  StoreSubscriber,
  get,
  joinAsync,
  pipe,
  toPromise,
} from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { AppletId, GroupProfile } from '@lightningrodlabs/we-applet';
import { mdiArrowLeft, mdiCog, mdiHelpCircle, mdiLinkVariantPlus } from '@mdi/js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import TimeAgo from 'javascript-time-ago';
import en from 'javascript-time-ago/locale/en';

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
import './related-groups.js';
import './add-related-group-dialog.js';
import './installable-applets.js';
import './group-applets.js';
import './group-applets-settings.js';
import './your-settings.js';
import './looking-for-peers.js';
import '../../custom-views/elements/all-custom-views.js';
import './create-custom-group-view.js';
import './edit-custom-group-view.js';
import '../../applet-bundles/elements/publish-applet-button.js';
import '../../elements/tab-group.js';
import '../../elements/loading-dialog.js';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { WeStore } from '../../we-store.js';
import { weStoreContext } from '../../context.js';
import { weStyles } from '../../shared-styles.js';
import { AppHashes, AppletHash, AssetSource, DistributionInfo } from '../../types.js';
import { AppEntry, Entity } from '../../processes/appstore/types.js';
import { Applet } from '../../applets/types.js';
import { LoadingDialog } from '../../elements/loading-dialog.js';
import { appIdFromAppletHash } from '../../utils.js';
import { dialogMessagebox } from '../../electron-api.js';

TimeAgo.addDefaultLocale(en);

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
  @consume({ context: weStoreContext, subscribe: true })
  weStore!: WeStore;

  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  updatesAvailable = new StoreSubscriber(
    this,
    () => this.weStore.updatesAvailableForGroup(this.groupStore.groupDnaHash),
    () => [this.weStore, this.groupStore],
  );

  @state()
  _peerStatusLoading = true;

  @state()
  _recentlyJoined: Array<AppletId> = [];

  @state()
  _showIgnoredApplets = false;

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
              let appstoreAppEntry: Entity<AppEntry> | undefined;
              let appletLogo: string | undefined;
              if (appletEntry) {
                const distributionInfo: DistributionInfo = JSON.parse(
                  appletEntry.distribution_info,
                );
                if (distributionInfo.type !== 'appstore-light')
                  throw new Error(
                    "Cannot get unjoined applets from distribution types other than appstore-light'",
                  );
                const appEntryId = decodeHashFromBase64(distributionInfo.info.appEntryId);
                try {
                  appstoreAppEntry = await toPromise(
                    this.weStore.appletBundlesStore.appletBundles.get(appEntryId),
                  );
                } catch (e) {
                  console.warn(
                    '@group-home @unjoined-applets: Failed to get appstoreAppEntry: ',
                    e,
                  );
                }
                try {
                  appletLogo = await toPromise(
                    this.weStore.appletBundlesStore.appletBundleLogo.get(appEntryId),
                  );
                } catch (e) {
                  console.warn('@group-home @unjoined-applets: Failed to get appletLogo: ', e);
                }
              }
              return [
                appletHash,
                appletEntry,
                appstoreAppEntry?.content ? appstoreAppEntry.content : undefined,
                appletLogo,
                agentKey,
                timestamp,
                joinedMembers,
              ] as [
                AppletHash,
                Applet | undefined,
                AppEntry | undefined,
                string | undefined,
                AgentPubKey,
                number,
                AgentPubKey[],
              ];
            },
          ),
        ),
      ),
    () => [this.groupStore, this.weStore],
  );

  @state()
  view: View = { view: 'main' };

  @state()
  _joiningNewApplet: string | undefined;

  groupProfile = new StoreSubscriber(
    this,
    () => {
      const store = joinAsync([
        this.groupStore.groupProfile,
        this.groupStore.networkSeed,
      ]) as AsyncReadable<[GroupProfile | undefined, string]>;
      // (window as any).groupProfileStore = store;
      return store;
    },
    () => [this.groupStore, this.weStore],
  );

  async firstUpdated() {
    // const allGroupApplets = await this.groupStore.groupClient.getGroupApplets();
    setTimeout(() => {
      this._peerStatusLoading = false;
    }, 2500);
  }

  async updateUi(e: CustomEvent) {
    const confirmation = await dialogMessagebox({
      message:
        'Updating an Applet UI will refresh the full We window. If you have unsaved changes in one of your applets, save them first.',
      type: 'warning',
      buttons: ['Cancel', 'Continue'],
    });
    if (confirmation.response === 0) return;
    (this.shadowRoot!.getElementById('loading-dialog') as LoadingDialog).show();
    console.log('appletHash: ', e.detail);
    const appId = appIdFromAppletHash(e.detail);
    console.log('appletId: ', appId);

    try {
      const appEntryEntity = get(this.weStore.updatableApplets())[encodeHashToBase64(e.detail)];
      if (!appEntryEntity)
        throw new Error('No AppEntry found in We Store for the requested UI update.');

      const assetsSource: AssetSource = JSON.parse(appEntryEntity.content.source);
      if (assetsSource.type !== 'https')
        throw new Error("Updating of applets is only implemented for sources of type 'http'");
      const appstoreDnaHash = await this.weStore.appletBundlesStore.appstoreDnaHash();
      const distributionInfo: DistributionInfo = {
        type: 'appstore-light',
        info: {
          appstoreDnaHash,
          appEntryId: encodeHashToBase64(appEntryEntity.id),
          appEntryActionHash: encodeHashToBase64(appEntryEntity.action),
          appEntryEntryHash: encodeHashToBase64(appEntryEntity.address),
        },
      };
      const appHashes: AppHashes = JSON.parse(appEntryEntity.content.hashes);
      if (appHashes.type !== 'webhapp')
        throw new Error(`Got invalid AppHashes type: ${appHashes.type}`);

      await window.electronAPI.updateAppletUi(
        appId,
        assetsSource.url,
        distributionInfo,
        appHashes.happ.sha256,
        appHashes.ui.sha256,
        appHashes.sha256,
      );
      await this.weStore.checkForUiUpdates();
      (this.shadowRoot!.getElementById('loading-dialog') as LoadingDialog).hide();
      notify(msg('Applet UI updated.'));
      window.location.reload();
    } catch (e) {
      console.error(`Failed to update UI: ${e}`);
      notifyError(msg('Failed to update the UI.'));
      (this.shadowRoot!.getElementById('loading-dialog') as LoadingDialog).hide();
    }
  }

  async uninstallApplet(e: CustomEvent) {
    const confirmation = await dialogMessagebox({
      message:
        'WARNING: Uninstalling an Applet instance is permanent. You will not be able to re-join the same Applet instance at a later point and all your local data associated to that Applet instance will be deleted. Other group members can keep using the Applet instance normally.',
      type: 'warning',
      buttons: ['Cancel', 'Continue'],
    });
    if (confirmation.response === 0) return;
    try {
      const appId = appIdFromAppletHash(e.detail);
      await window.electronAPI.uninstallApplet(appId);
      this.weStore.reloadManualStores();
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
      notify('Applet installed.');
      this._recentlyJoined.push(encodeHashToBase64(appletHash));
      this._showIgnoredApplets = false;
    } catch (e) {
      notifyError(`Failed to join Applet (See console for details).`);
      console.error(e);
    }
    this._joiningNewApplet = undefined;
  }

  ignoreApplet(appletHash: AppletHash) {
    const groupDnaHashB64 = encodeHashToBase64(this.groupStore.groupDnaHash);
    let ignoredApplets = this.weStore.persistedStore.ignoredApplets.value(groupDnaHashB64);
    ignoredApplets.push(encodeHashToBase64(appletHash));
    // deduplicate ignored applets
    ignoredApplets = Array.from(new Set(ignoredApplets));
    this.weStore.persistedStore.ignoredApplets.set(ignoredApplets, groupDnaHashB64);
    this.requestUpdate();
  }

  toggleIgnoredApplets() {
    const checkbox = this.shadowRoot!.getElementById(
      'show-ignored-applets-checkbox',
    ) as HTMLInputElement;
    this._showIgnoredApplets = checkbox.checked;
    this.requestUpdate();
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
        const ignoredApplets = this.weStore.persistedStore.ignoredApplets.value(
          encodeHashToBase64(this.groupStore.groupDnaHash),
        );
        const filteredApplets = this._unjoinedApplets.value.value
          .filter(
            ([appletHash, _]) => !this._recentlyJoined.includes(encodeHashToBase64(appletHash)),
          )
          .map(([appletHash, appletEntry, appEntry, logo, agentKey, timestamp, joinedMembers]) => ({
            appletHash,
            appletEntry,
            appEntry,
            logo,
            agentKey,
            timestamp,
            joinedMembers,
            isIgnored: !!ignoredApplets && ignoredApplets.includes(encodeHashToBase64(appletHash)),
          }))
          .filter((info) => (info.isIgnored ? this._showIgnoredApplets : true));

        if (filteredApplets.length === 0) {
          return html`${msg('No new applets to install.')}`;
        }
        return html`
          <div class="row" style="flex-wrap: wrap;">
            ${filteredApplets.map(
              (info) => html`
                <sl-card class="applet-card">
                  <div class="column" style="flex: 1;">
                    <div style="margin-bottom: 3px; text-align: right; opacity: 0.65;">
                      ${timeAgo.format(new Date(info.timestamp / 1000))}
                    </div>
                    <div class="row" style="align-items: center;">
                      <agent-avatar
                        .size=${40}
                        style="margin-left: 5px;"
                        .agentPubKey=${info.agentKey}
                      ></agent-avatar>
                      <span style="margin-left: 10px; margin-right: 10px;"
                        >${msg('added a new instance of ')}</span
                      >
                      <sl-tooltip
                        style="${info.appEntry ? '' : 'display: none;'}"
                        content="${info.appEntry?.subtitle}"
                      >
                        <div class="row" style="align-items: center; cursor: help;">
                          ${info.logo
                            ? html`<img src=${info.logo} alt="Applet logo" style="height: 40px;" />`
                            : html``}
                          <span
                            style="margin-left: 5px; font-weight: bold; ${info.appEntry?.title
                              ? ''
                              : 'opacity: 0.6;'}"
                            >${info.appEntry ? info.appEntry.title : 'unknown'}&nbsp;</span
                          >
                        </div>
                      </sl-tooltip>
                      <span style="margin-left: 10px; margin-right: 10px;"
                        >${msg('with the name ')}</span
                      >
                      <span style="font-weight: bold;"
                        >${info.appletEntry ? info.appletEntry.custom_name : 'unknown'}</span
                      >
                    </div>
                    <div class="row" style="align-items: center; margin-top: 20px;">
                      <span style="margin-right: 5px;"><b>${msg('joined by: ')}</b></span>
                      ${info.joinedMembers.map(
                        (agentKey) => html`
                          <agent-avatar
                            style="margin-left: 5px;"
                            .agentPubKey=${agentKey}
                          ></agent-avatar>
                        `,
                      )}
                      <span style="display: flex; flex: 1;"></span>
                      <sl-button
                        style="margin-left: 20px;"
                        .loading=${this._joiningNewApplet === encodeHashToBase64(info.appletHash)}
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
        `;
      default:
        return html``;
    }
  }

  renderMain(groupProfile: GroupProfile, networkSeed: string) {
    return html`
      <span style="position: absolute; bottom: 5px; left: 10px;"
        >${msg('Group DNA Hash: ')}${encodeHashToBase64(this.groupStore.groupDnaHash)}</span
      >
      <div class="row" style="flex: 1; max-height: calc(100vh - 74px);">
        <div class="column" style="flex: 1; padding: 16px; overflow-y: auto; position: relative;">

        <div style=" background-image: url(${
          groupProfile.logo_src
        }); background-size: cover; filter: blur(10px); position: absolute; top: 0; bottom: 0; left: 0; right: 0; opacity: 0.2; z-index: -1;"></div>

          <!-- Top Row -->

          <div class="row" style="align-items: center; margin-bottom: 24px">
            <div class="row" style="align-items: center; flex: 1;">
              <img
                .src=${groupProfile.logo_src}
                style="height: 64px; width: 64px; margin-right: 16px; border-radius: 50%"
                alt="${groupProfile.name}"
              />
              <span class="title">${groupProfile.name}</span>
            </div>

            <div style="position: relative;">
              ${
                !!this.updatesAvailable.value
                  ? html`<div
                      style="position: absolute; top: 6px; right: 4px; background-color: #21c607; height: 12px; width: 12px; border-radius: 50%; border: 2px solid white;"
                    ></div>`
                  : html``
              }
              <sl-icon-button
                .src=${wrapPathInSvg(mdiCog)}
                title=${!!this.updatesAvailable.value ? 'Applet Updates available' : ''}
                @click=${() => {
                  this.view = { view: 'settings' };
                }}
                style="font-size: 2rem;"
              ></sl-icon-button>
            </div>
          </div>

          <!-- NEW APPLETS -->
          <div class="row" style="align-items: center;">
            <span class="title">${msg('Joinable Applets')}</span>
            <sl-tooltip content="${msg(
              'Applet instances that have been added to this group by other members via the Applet Library show up here for you to join as well.',
            )}">
              <sl-icon style="height: 28px; width: 28px; margin-left: 10px; cursor: help;" .src=${wrapPathInSvg(
                mdiHelpCircle,
              )}><sl-icon>
            </sl-tooltip>
          </div>
          <sl-divider style="--color: grey"></sl-divider>
          <div class="row" style="align-items: center; justify-content: flex-end; margin-top: -10px;">
            <input @input=${() =>
              this.toggleIgnoredApplets()} id="show-ignored-applets-checkbox" type="checkbox">
            <span>${msg('Show ignored Applets')}</span>
          </div>
          ${this.renderNewApplets()}
        </div>

        <div
          class="column online-status-bar"
        >
          <div class="flex-scrollable-parent">
            <div class="flex-scrollable-container">
              <div class="flex-scrollable-y">
                ${
                  this._peerStatusLoading
                    ? html`<div
                        class="column center-content"
                        style="margin-top: 20px; font-size: 20px;"
                      >
                        <sl-spinner></sl-spinner>
                      </div>`
                    : html``
                }
                <group-peers-status style="${
                  this._peerStatusLoading ? 'display: none;' : ''
                }"></group-peers-status>
              </div>
            </div>
          </div>

          <sl-dialog id="invite-member-dialog" .label=${msg('Invite New Member')}>
            <div class="column">
              <span>${msg('To invite other people to join this group, send them this link:')}</span>

              <div class="row" style="margin-top: 16px">
                <sl-input
                  value="https://lightningrodlabs.org/we?we://group/${networkSeed}"
                  style="margin-right: 8px; flex: 1"
                >
                </sl-input>
                <sl-button
                  variant="primary"
                  @click=${async () => {
                    await navigator.clipboard.writeText(
                      `https://lightningrodlabs.org/we?we://group/${networkSeed}`,
                    );
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
                style="color: white; height: 25px; width: 25px; margin-right: 12px;"
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
        'Applets',
        html`<group-applets-settings
          @update-ui=${async (e) => this.updateUi(e)}
          @uninstall-applet=${async (e) => this.uninstallApplet(e)}
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

    return html`
      <loading-dialog id="loading-dialog" loadingText="Updating UI..."></loading-dialog>
      <div class="column" style="flex: 1; position: relative;">
        <div class="row" style="height: 68px; align-items: center; background: var(--sl-color-primary-200)">
          <sl-icon-button
            .src=${wrapPathInSvg(mdiArrowLeft)}
            @click=${() => {
              this.view = { view: 'main' };
            }}
            style="margin-left: 20px; font-size: 30px;"
          ></sl-icon-button>
          <span style="display: flex; flex: 1;"></span>
          <span class="title" style="margin-right: 20px; font-weight: bold;">${msg(
            'Group Settings',
          )}</span>
        </div>

        <tab-group .tabs=${tabs} style="display: flex; flex: 1;">
        <tab-group>
      </div>
    `;
  }

  renderContent(groupProfile: GroupProfile, networkSeed: string) {
    switch (this.view.view) {
      case 'main':
        return this.renderMain(groupProfile, networkSeed);
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
        const networkSeed = this.groupProfile.value.value[1];

        if (!groupProfile)
          return html`<looking-for-peers style="display: flex; flex: 1;"></looking-for-peers>`;

        return html`
          <profile-prompt
            ><span slot="hero" style="max-width: 500px; margin-bottom: 32px" class="placeholder"
              >${msg(
                'Create your personal profile for this group. Only members of this group will be able to see your profile.',
              )}</span
            >
            ${this.renderContent(groupProfile, networkSeed)}
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
        background-color: rgba(86, 113, 71, 1.0);
        padding: 8px;
        border-radius: 5px 0 0 0;
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
      }
      .invite-btn::part(base) {
        background-color: var(--sl-color-secondary-200);
        border-color: var(--sl-color-secondary-200);
      }
      .applet-card {
        width: 100%;
        margin: 10px;
        --border-radius: 15px;
        border: none;
        --border-color: transparent;
        --sl-panel-background-color: var(--sl-color-tertiary-0);
      }
      .online-status-bar {
        color: var(--sl-color-secondary-100);
        width: 260px;
        padding: 16px;
      }
    `,
  ];
}

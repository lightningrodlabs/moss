import { notify, notifyError, wrapPathInSvg } from '@holochain-open-dev/elements';
import { localized, msg } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ActionHash, AgentPubKey, EntryHash, encodeHashToBase64 } from '@holochain/client';
import {
  AsyncReadable,
  StoreSubscriber,
  joinAsync,
  pipe,
  toPromise,
} from '@holochain-open-dev/stores';
import { consume } from '@lit-labs/context';
import { GroupProfile } from '@lightningrodlabs/we-applet';
import { mdiArrowLeft, mdiCog, mdiLinkVariantPlus } from '@mdi/js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

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
import { LoadingDialog } from '../../elements/loading-dialog.js';
import { AppletHash } from '../../types.js';
import { AppEntry, Entity } from '../../processes/appstore/types.js';
import { Applet } from '../../applets/types.js';

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
    () => this.groupStore.appletUiUpdatesAvailable,
    () => [this.weStore, this.groupStore],
  );

  _unjoinedApplets = new StoreSubscriber(
    this,
    () =>
      pipe(this.groupStore.unjoinedApplets, async (appletsAndKeys) =>
        Promise.all(
          appletsAndKeys.map(async ([appletHash, agentKey]) => {
            const appletEntry = await toPromise(this.groupStore.applets.get(appletHash));
            let appstoreAppEntry: Entity<AppEntry> | undefined;
            let appletLogo: string | undefined;
            if (appletEntry) {
              appstoreAppEntry = await toPromise(
                this.weStore.appletBundlesStore.appletBundles.get(appletEntry.appstore_app_hash),
              );
              appletLogo = await toPromise(
                this.weStore.appletBundlesStore.appletBundleLogo.get(appletEntry.appstore_app_hash),
              );
            }
            return [
              appletHash,
              appletEntry,
              appstoreAppEntry?.content ? appstoreAppEntry.content : undefined,
              appletLogo,
              agentKey,
            ] as [
              AppletHash,
              Applet | undefined,
              AppEntry | undefined,
              string | undefined,
              AgentPubKey,
            ];
          }),
        ),
      ),
    () => [this.groupStore, this.weStore],
  );

  @state()
  view: View = { view: 'main' };

  @state()
  _joiningNewApplet: boolean = false;

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
    const allGroupApplets = await this.groupStore.groupClient.getGroupApplets();
  }

  async updateUi(_e: CustomEvent) {
    throw new Error('Updating UI not implemented.');
    // (this.shadowRoot!.getElementById('loading-dialog') as LoadingDialog).show();
    // console.log('appletHash: ', e.detail);
    // const appId = `applet#${encodeHashToBase64(e.detail as AppletHash)}`;
    // console.log('appletId: ', appId);

    // try {
    //   const resourceLocatorB64 = this.weStore.availableUiUpdates[appId];
    //   console.log('resourceLocatorB64: ', resourceLocatorB64);

    //   const payload = {
    //     appId,
    //     devhubDnaHash: resourceLocatorB64.dna_hash,
    //     guiReleaseHash: resourceLocatorB64.resource_hash,
    //   };
    //   console.log('Updating UI with payload: ', payload);
    //   await invoke('update_applet_ui', payload);
    //   await this.weStore.fetchAvailableUiUpdates();
    //   (this.shadowRoot!.getElementById('loading-dialog') as LoadingDialog).hide();
    //   notify(msg('Applet UI updated.'));
    //   this.requestUpdate();
    // } catch (e) {
    //   console.error(`Failed to update UI: ${e}`);
    //   notifyError(msg('Failed to update the UI.'));
    //   (this.shadowRoot!.getElementById('loading-dialog') as LoadingDialog).hide();
    // }
  }

  async joinNewApplet(appletHash: AppletHash) {
    this._joiningNewApplet = true;
    try {
      console.log('Trying to join applet.');
      await this.groupStore.installApplet(appletHash);
      console.log('Successfully installed applet.');
    } catch (e) {
      notifyError(`Failed to join Applet (See console for details).`);
      console.error(e);
    }
    this._joiningNewApplet = false;
  }

  renderNewApplets() {
    switch (this._unjoinedApplets.value.status) {
      // TODO handle loading and error case nicely
      case 'complete':
        return html`
          <span class="title">New Group Applets</span>
          <sl-divider style="--color: grey"></sl-divider>

          <div class="row" style="flex-wrap: wrap;">
            ${this._unjoinedApplets.value.value.map(
              ([appletHash, appletEntry, appEntry, logo, agentKey]) => html`
                <sl-card class="applet-card">
                  <div class="column" style="flex: 1;">
                    <div class="row" style="align-items: center; margin-bottom: 10px;">
                      ${
                        logo
                          ? html`<img src=${logo} alt="Applet logo" style="height: 45px;" />`
                          : html``
                      }
                      <span style="margin-left: 10px; font-size: 20px;">${
                        appEntry ? appEntry.title : '<i>unknwon</i>'
                      }&nbsp;</span>
                    </div>
                    <div class="row" style="align-items: center; margin-bottom: 5px;">
                      <b>name:</b>&nbsp;${appletEntry ? appletEntry.custom_name : '<i>unknown</i>'}
                    </div>
                    <div class="row" style="align-items: center; margin-bottom: 20px;">
                      <span><b>added by:</b></span>
                      <profile-detail style="margin-left: 5px;" .agentPubKey=${agentKey}></profile-detail>
                    </div>
                    <sl-button .loading=${this._joiningNewApplet} variant="primary" @click=${() =>
                      this.joinNewApplet(appletHash)}>Join</sl-button>
                  <div>
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
      <div class="row" style="flex: 1">
        <div class="column" style="flex: 1; margin: 16px;">
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
              ${this.updatesAvailable.value.status === 'complete' &&
              this.updatesAvailable.value.value
                ? html`<div
                    style="position: absolute; top: 6px; right: 4px; background-color: #21c607; height: 12px; width: 12px; border-radius: 50%; border: 2px solid white;"
                  ></div>`
                : html``}
              <sl-icon-button
                .src=${wrapPathInSvg(mdiCog)}
                title=${this.updatesAvailable.value.status === 'complete' &&
                this.updatesAvailable.value.value
                  ? 'Applet Updates available'
                  : ''}
                @click=${() => {
                  this.view = { view: 'settings' };
                }}
                style="font-size: 2rem;"
              ></sl-icon-button>
            </div>
          </div>

          <!-- NEW APPLETS -->
          ${this.renderNewApplets()}

          <!-- Related Groups Row -->

          <div class="row">
            <div class="column" style="flex: 1; margin-right: 16px">
              <!-- <span class="title">Installed Applets</span>
              <sl-divider style="--color: grey"></sl-divider>
              <group-applets style="flex: 1; margin: 10px;"></group-applets> -->
              <related-groups style="flex: 1; margin: 10px; margin-top: 30px;"></related-groups>
            </div>
          </div>
        </div>

        <div
          class="column"
          style="width: 260px; padding: 16px; background-color: var(--sl-color-primary-100)"
        >
          <div class="flex-scrollable-parent">
            <div class="flex-scrollable-container">
              <div class="flex-scrollable-y">
                <group-peers-status></group-peers-status>
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
      // ["Related Groups", html`
      //   <add-related-group-dialog
      //     id="add-related-group-dialog"
      //   ></add-related-group-dialog>
      //   <div class="column" style="flex: 1;">
      //     <span style="margin-bottom: 8px" class="placeholder"
      //       >${msg(
      //         "You can add related groups to this group so that members of this group can see and join the related groups."
      //       )}</span
      //     >
      //     <related-groups style="flex: 1;"></related-groups>
      //     <div class="row" style="flex: 1;">
      //       <span style="flex: 1"></span>
      //       <sl-button
      //         variant="primary"
      //         @click=${() => {
      //           (
      //             this.shadowRoot?.getElementById(
      //               "add-related-group-dialog"
      //             ) as AddRelatedGroupDialog
      //           ).show();
      //         }}
      //         >${msg("Add a related group")}</sl-button
      //       >
      //     </div>
      //   </div>
      // `],
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
      .applet-card {
        width: 300px;
        height: 210px;
        margin: 10px;
        --border-radius: 15px;
        border: none;
        --border-color: transparent;
      }
    `,
  ];
}

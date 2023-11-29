import { hashProperty, notifyError, wrapPathInSvg } from '@holochain-open-dev/elements';
import { AsyncReadable, joinAsync, StoreSubscriber } from '@holochain-open-dev/stores';
import { DnaHash, EntryHash } from '@holochain/client';
import { consume } from '@lit-labs/context';
import { localized, msg } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { mdiAlertOutline, mdiInformationOutline } from '@mdi/js';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';
import { GroupProfile, AppletView, RenderView, AppletHash } from '@lightningrodlabs/we-applet';

import { weStyles } from '../../shared-styles.js';
import './view-frame.js';
import { WeStore } from '../../we-store.js';
import { weStoreContext } from '../../context.js';
import { AppletStore } from '../../applets/applet-store.js';
import { GroupStore } from '../../groups/group-store.js';
import { Applet } from '../../applets/types.js';

@localized()
@customElement('applet-view')
export class AppletViewEl extends LitElement {
  @consume({ context: weStoreContext, subscribe: true })
  weStore!: WeStore;

  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  @state()
  installing = false;

  @state()
  registering = false;

  @property()
  view!: AppletView;

  @state()
  _applet = new StoreSubscriber(
    this,
    () =>
      joinAsync([
        this.weStore.appletStores.get(this.appletHash),
        this.weStore.isInstalled.get(this.appletHash),
        this.weStore.groupsForApplet.get(this.appletHash),
        this.weStore.allGroupsProfiles,
      ]) as AsyncReadable<
        [
          AppletStore | undefined,
          boolean,
          ReadonlyMap<DnaHash, GroupStore>,
          ReadonlyMap<DnaHash, GroupProfile | undefined>,
        ]
      >,
    () => [this.appletHash, this.weStore],
  );

  // @state()
  // _installationProgress: string | undefined;

  // _unlisten: UnlistenFn | undefined;

  // async firstUpdated() {
  //   console.log('@applet-view: got this._applet.value: ', this._applet.value);
  //   // TODO it's inefficient to have this event listener by default in the applet-view also if applet is already installed
  //   this._unlisten = await listen('applet-install-progress', (event) => {
  //     this._installationProgress = event.payload as string;
  //   });
  // }

  // disconnectedCallback(): void {
  //   if (this._unlisten) this._unlisten();
  // }

  // async regitsterApplet(groupDnaHash: DnaHash, appletStore: AppletStore) {
  //   if (this.registering) return;

  //   this.registering = true;
  //   try {
  //     const groupStore = await toPromise(this.weStore.groups.get(groupDnaHash));

  //     if (!appletStore) throw new Error("Applet not found");

  //     const applet = appletStore.applet;
  //     await groupStore.groupClient.registerApplet(applet);
  //     await this.weStore.appletBundlesStore.installApplet(
  //       this.appletHash,
  //       appletStore.applet
  //     );
  //   } catch (e) {
  //     notifyError(msg("Error registering applet."));
  //     console.error(e);
  //   }

  //   this.registering = false;
  // }

  /**
   * Fetches the applet from the devhub, installs it in the current conductor
   * and stores the Applet entry to the local source chain for each of the groups.
   */
  async joinAndInstallApplet(
    appletHash: AppletHash,
    applet: Applet,
    groupsForApplet: ReadonlyMap<DnaHash, GroupStore>,
  ): Promise<EntryHash> {
    await this.weStore.installApplet(appletHash, applet, applet.initial_devhub_gui_release_hash);

    try {
      await Promise.all(
        Array.from(groupsForApplet.values()).map(async (groupStore) => {
          await groupStore.groupClient.registerApplet(applet);
          await groupStore.allMyApplets.reload();
          await groupStore.allMyRunningApplets.reload();
        }),
      );
    } catch (e) {
      console.error(
        `Failed to register Applet in groups after installation. Uninstalling again. Error:\n${e}.`,
      );
      try {
        await this.weStore.uninstallApplet(appletHash);
        return Promise.reject(
          new Error(`Failed to register Applet: ${e}.\nApplet uninstalled again.`),
        );
      } catch (err) {
        console.error(`Failed to undo installation of Applet after failed registration: ${err}`);
        return Promise.reject(
          new Error(
            `Failed to register Applet (E1) and Applet could not be uninstalled again (E2):\nE1: ${e}\nE2: ${err}`,
          ),
        );
      }
    }

    return appletHash;
  }

  renderAppletFrame([appletStore, isInstalled, groupsForThisApplet, _allGroups]: [
    AppletStore | undefined,
    boolean,
    ReadonlyMap<DnaHash, GroupStore>,
    ReadonlyMap<DnaHash, GroupProfile | undefined>,
  ]) {
    // console.log("#########\nRendering applet frame:");
    // console.log("|-- isInstalled: ", isInstalled);
    // console.log("|-- appletStore: ", appletStore);
    // console.log("|-- groupsForThisApplet: ", groupsForThisApplet);
    // console.log("|-- allGroups: ", allGroups);
    if (!appletStore)
      return html`
        <div class="row center-content" style="flex: 1">
          <sl-card
            ><div class="column center-content">
              <sl-icon
                .src=${wrapPathInSvg(mdiAlertOutline)}
                style="font-size: 64px; margin-bottom: 16px"
              ></sl-icon>
              <span style="margin-bottom: 4px">${msg('Applet not found.')}</span>
              <span style="margin-bottom: 16px"
                >${msg(
                  'Join a group with this applet installed it if you want to see this view.',
                )}</span
              >
            </div></sl-card
          >
        </div>
      `;

    // if (groupsForThisApplet.size === 0) {
    //   // Applet was just archived by another member of the group
    //   return html`
    //     <div class="row center-content" style="flex: 1">
    //       <sl-card
    //         ><form
    //           style="flex: 1"
    //           ${onSubmit((f) =>
    //             this.regitsterApplet(
    //               decodeHashFromBase64(f.groupDnaHash),
    //               appletStore
    //             )
    //           )}
    //         >
    //           <div class="column center-content">
    //             <sl-icon
    //               .src=${wrapPathInSvg(mdiAlertOutline)}
    //               style="font-size: 64px; margin-bottom: 16px"
    //             ></sl-icon>
    //             <span style="margin-bottom: 4px"
    //               >${msg(
    //                 "This applet was just archived in all the groups that had it registered."
    //               )}</span
    //             >
    //             <span style="margin-bottom: 16px"
    //               >${msg(
    //                 "If you want to continue to use it, you must register it in another group."
    //               )}</span
    //             >
    //             <span style="margin-bottom: 16px"
    //               >${msg(
    //                 "You can also just close this window if you don't want to continue using it."
    //               )}</span
    //             >
    //             <sl-select
    //               .placeholder=${msg("Select Group")}
    //               name="groupDnaHash"
    //               @sl-hide=${(e) => e.stopPropagation()}
    //               style="margin-bottom: 16px"
    //               required
    //             >
    //               ${Array.from(allGroups.entries()).map(
    //                 ([groupDnaHash, groupProfile]) => html`
    //                   <sl-option .value=${encodeHashToBase64(groupDnaHash)}>
    //                     <img
    //                       slot="prefix"
    //                       .src=${groupProfile?.logo_src}
    //                       alt="${groupProfile?.name}"
    //                       style="height: 16px; width: 16px"
    //                     />${groupProfile?.name}</sl-option
    //                   >
    //                 `
    //               )}
    //             </sl-select>
    //           </div>
    //           <div class="row " style="flex: 1">
    //             <span style="flex: 1"></span>
    //             <sl-button
    //               variant="primary"
    //               .loading=${this.registering}
    //               type="submit"
    //               >${msg("Register Applet")}</sl-button
    //             >
    //           </div>
    //         </form></sl-card
    //       >
    //     </div>
    //   `;
    // }

    if (!isInstalled) {
      return html`
        <div class="row center-content" style="flex: 1">
          <sl-card
            ><div class="column center-content">
              <sl-icon
                .src=${wrapPathInSvg(mdiInformationOutline)}
                style="font-size: 64px; margin-bottom: 16px"
              ></sl-icon>
              <span style="margin-bottom: 4px"
                >${msg("You don't have this applet installed yet.")}</span
              >
              <span style="margin-bottom: 16px"
                >${msg('Install it if you want to see this view.')}</span
              >
              <sl-button
                variant="primary"
                .loading=${this.installing}
                @click=${async () => {
                  this.installing = true;
                  try {
                    await this.joinAndInstallApplet(
                      this.appletHash,
                      appletStore.applet,
                      groupsForThisApplet,
                    );
                    this.dispatchEvent(
                      new CustomEvent('applet-installed', {
                        detail: {
                          appletEntryHash: this.appletHash,
                          groupDnaHash: groupsForThisApplet.keys()[0],
                        },
                        composed: true,
                        bubbles: true,
                      }),
                    );
                  } catch (e) {
                    notifyError(msg("Couldn't install applet"));
                    console.error(e);
                  }
                  this.installing = false;
                }}
                >${msg('Install Applet')}
              </sl-button>
              <!-- <div>${this._installationProgress}</div> -->
            </div></sl-card
          >
        </div>
      `;
    }

    const renderView: RenderView = {
      type: 'applet-view',
      view: this.view,
    };
    return html`
      <view-frame
        .renderView=${renderView}
        .appletHash=${this.appletHash}
        style="flex: 1"
      ></view-frame>
    `;
  }

  render() {
    switch (this._applet.value?.status) {
      case 'pending':
        return html`<div class="row center-content" style="flex: 1">
          <sl-spinner style="font-size: 2rem"></sl-spinner>
        </div>`;
      case 'error':
        return html`<display-error
          .headline=${msg('Error initializing the client for this group')}
          .error=${this._applet.value.error}
        ></display-error>`;
      case 'complete':
        return this.renderAppletFrame(this._applet.value.value);
    }
  }

  static styles = [
    css`
      :host {
        display: flex;
      }
    `,
    weStyles,
  ];
}

import { consume, provide } from '@lit/context';
import { state, customElement, query, property } from 'lit/decorators.js';
import { encodeHashToBase64, DnaHash, decodeHashFromBase64, DnaHashB64 } from '@holochain/client';
import { LitElement, html, css, TemplateResult } from 'lit';
import { asyncDeriveStore, joinAsyncMap, toPromise } from '@holochain-open-dev/stores';
import { Hrl, mapValues } from '@holochain-open-dev/utils';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { msg } from '@lit/localize';
import { mdiMagnify, mdiTableRow } from '@mdi/js';
import { AppletHash, AppletId, HrlWithContext } from '@lightningrodlabs/we-applet';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@lightningrodlabs/we-elements/dist/elements/we-client-context.js';
import '@lightningrodlabs/we-elements/dist/elements/search-entry.js';
import '@lightningrodlabs/we-elements/dist/elements/hrl-to-clipboard.js';

import '../layout/views/welcome-view.js';
import '../groups/elements/entry-title.js';
import './groups-sidebar.js';
import './group-applets-sidebar.js';
import './join-group-dialog.js';
import './search-bar.js';
import '../layout/views/applet-main.js';
import '../layout/views/appstore-view.js';
import '../layout/views/publishing-view.js';
import '../layout/views/entry-view.js';
import '../groups/elements/group-home.js';

import { weStyles } from '../shared-styles.js';
import { weStoreContext } from '../context.js';
import { WeStore } from '../we-store.js';
import { JoinGroupDialog } from './join-group-dialog.js';
import { weLogoIcon } from '../icons/we-logo-icon.js';
import { CreateGroupDialog } from './create-group-dialog.js';

import './clipboard.js';
import { WeClipboard } from './clipboard.js';
import { setupAppletMessageHandler } from '../applets/applet-host.js';
import { openViewsContext } from '../layout/context.js';
import { AppOpenViews } from '../layout/types.js';

type OpenTab =
  | {
      type: 'hrl';
      hrl: HrlWithContext;
      groupHashesB64: DnaHashB64[];
      appletIds: AppletId[];
    }
  | {
      type: 'html';
      template: TemplateResult;
      title: string;
      icon?: string;
    };

export type TabInfo = {
  id: string;
  tab: OpenTab;
};

type DashboardState =
  | {
      viewType: 'personal';
    }
  | { viewType: 'group'; groupHash: DnaHash; appletHash?: AppletHash };

@customElement('main-dashboard')
export class MainDashboard extends LitElement {
  @consume({ context: weStoreContext })
  @state()
  _weStore!: WeStore;

  @query('join-group-dialog')
  joinGroupDialog!: JoinGroupDialog;

  @query('#clipboard')
  _clipboard!: WeClipboard;

  @state()
  showClipboard: boolean = false;

  @state()
  _openApplets: Array<AppletId> = [];

  @state()
  _openTabs: Record<string, TabInfo> = {}; // open tabs by id

  @state()
  _selectedTab: TabInfo | undefined;

  @state()
  _showTabView = false;

  @state()
  dashboardState: DashboardState = {
    viewType: 'personal',
  };

  // _unlisten: UnlistenFn | undefined;

  @provide({ context: openViewsContext })
  @property()
  openViews: AppOpenViews = {
    openAppletMain: async (appletHash) => {
      const groupsForApplet = await toPromise(this._weStore.groupsForApplet.get(appletHash));
      const groupDnaHashes = Array.from(groupsForApplet.keys());
      if (groupDnaHashes.length === 0) throw new Error('Applet not found in any of the groups.');
      // pick an arbitrary group this applet is installed in
      const groupDnaHash = groupDnaHashes[0];
      const appletId = encodeHashToBase64(appletHash);
      if (!this._openApplets.includes(appletId)) {
        this._openApplets.push(appletId);
      }
      this.dashboardState = {
        viewType: 'group',
        groupHash: groupDnaHash,
        appletHash,
      };
    },
    openAppletBlock: (_appletHash, _block, _context) => {
      throw new Error('Opening applet blocks is currently not implemented.');
    },
    openCrossAppletMain: (_appletBundleHash) => {
      throw new Error('Opening cross-applet main views is currently not implemented.');
    },
    openCrossAppletBlock: (_appletBundleHash, _block, _context) => {
      throw new Error('Opening cross-applet blocks is currently not implemented.');
    },
    openHrl: async (hrl: Hrl, context: any) => {
      const tabId = `hrl://${encodeHashToBase64(hrl[0])}/${encodeHashToBase64(hrl[1])}`;
      const [groupContextHashesB64, appletContextIds] = await this.getRelatedGroupsAndApplets(hrl);
      const tabInfo: TabInfo = {
        id: tabId,
        tab: {
          type: 'hrl',
          hrl: {
            hrl,
            context,
          },
          groupHashesB64: groupContextHashesB64,
          appletIds: appletContextIds,
        },
      };
      this.openTab(tabInfo);
    },
    userSelectHrl: async () => {
      this.dispatchEvent(
        new CustomEvent('select-hrl-request', {
          bubbles: true,
          detail: 'select-hrl',
        }),
      );

      return new Promise((resolve) => {
        const listener = (e) => {
          switch (e.type) {
            case 'cancel-select-hrl':
              this.removeEventListener('cancel-select-hrl', listener);
              return resolve(undefined);
            case 'hrl-selected':
              const hrlWithContext: HrlWithContext = e.detail.hrlWithContext;
              this.removeEventListener('hrl-selected', listener);
              return resolve(hrlWithContext);
          }
        };
        this.addEventListener('hrl-selected', listener);
        this.addEventListener('cancel-select-hrl', listener);
      });
    },
    toggleClipboard: () => this.toggleClipboard(),
  };

  displayApplet(appletId: AppletId) {
    return (
      this.dashboardState.viewType === 'group' &&
      this.dashboardState.appletHash &&
      encodeHashToBase64(this.dashboardState.appletHash) === appletId
    );
  }

  openPublishingView() {
    const tabId = 'publishing-view';
    const tabInfo: TabInfo = {
      id: tabId,
      tab: {
        type: 'html',
        title: 'Publish Applet',
        template: html` <publishing-view></publishing-view> `,
      },
    };
    this.openTab(tabInfo);
  }

  openAppStore() {
    const tabId = 'app-library';
    const tabInfo: TabInfo = {
      id: tabId,
      tab: {
        type: 'html',
        title: 'App Library',
        template: html`
          <appstore-view
            style="display: flex; flex: 1;"
            @open-publishing-view=${() => this.openPublishingView()}
          ></appstore-view>
        `,
      },
    };
    this.openTab(tabInfo);
  }

  async getRelatedGroupsAndApplets(hrl: Hrl): Promise<[DnaHashB64[], AppletId[]]> {
    const location = await toPromise(this._weStore.hrlLocations.get(hrl[0]).get(hrl[1]));
    if (location) {
      const appletContextHashes = [encodeHashToBase64(location.dnaLocation.appletHash)];
      const groupsForApplet = await toPromise(
        this._weStore.groupsForApplet.get(location.dnaLocation.appletHash),
      );
      const groupDnaHashes = Array.from(groupsForApplet.keys());
      const groupContextHashesB64 = groupDnaHashes.map((hash) => encodeHashToBase64(hash));
      return [groupContextHashesB64, appletContextHashes];
    } else {
      return [[], []];
    }
  }

  async openTab(tabInfo: TabInfo) {
    const alreadyOpen = Object.values(this._openTabs).find(
      (tabInfoExisting) => tabInfo.id === tabInfoExisting.id,
    );
    if (!alreadyOpen) {
      this._openTabs[tabInfo.id] = tabInfo;
    }
    if (
      this.dashboardState.viewType === 'personal' &&
      tabInfo.tab.type === 'hrl' &&
      tabInfo.tab.groupHashesB64.length > 0
    ) {
      this.dashboardState = {
        viewType: 'group',
        groupHash: decodeHashFromBase64(tabInfo.tab.groupHashesB64[0]),
      };
    }
    this._showTabView = true;
    this._selectedTab = tabInfo;
  }

  async handleOpenGroup(networkSeed: string) {
    const groups = await toPromise(
      asyncDeriveStore(this._weStore.groupStores, (groups) =>
        joinAsyncMap(mapValues(groups, (groupStore) => groupStore.networkSeed)),
      ),
    );

    const alreadyJoinedGroup = Array.from(groups.entries()).find(
      ([_, groupNetworkSeed]) => groupNetworkSeed === networkSeed,
    );

    if (alreadyJoinedGroup) {
      this.openGroup(alreadyJoinedGroup[0]);
    } else {
      this.joinGroupDialog.open(networkSeed);
    }
  }

  // async handleOpenHrl(dnaHash: DnaHash, hash: AnyDhtHash) {
  //   this.selectedGroupDnaHash = undefined;
  // }

  // async handleOpenAppletMain(appletHash: AppletHash) {
  //   this.selectedGroupDnaHash = undefined;
  //   this.dashboardMode = 'groupView';
  //   // this.dynamicLayout.openViews.openAppletMain(appletHash);
  // }

  async firstUpdated() {
    setupAppletMessageHandler(this._weStore, this.openViews);
    // this._unlisten = await listen('deep-link-received', async (e) => {
    //   const deepLink = e.payload as string;
    //   try {
    //     const split = deepLink.split('://');
    //     const split2 = split[1].split('/');

    //     if (split2[0] === 'hrl') {
    //       await this.handleOpenHrl(
    //         decodeHashFromBase64(split2[1]),
    //         decodeHashFromBase64(split2[2]),
    //       );
    //     } else if (split2[0] === 'group') {
    //       await this.handleOpenGroup(split2[1]);
    //     } else if (split2[0] === 'applet') {
    //       await this.handleOpenAppletMain(decodeHashFromBase64(split2[1]));
    //     }
    //   } catch (e) {
    //     console.error(e);
    //     notifyError(msg('Error opening the link.'));
    //   }
    // });

    // add eventlistener for clipboard
    window.addEventListener('keydown', (zEvent) => {
      if (zEvent.altKey && zEvent.key === 's') {
        // case sensitive
        switch (this.showClipboard) {
          case false:
            this.showClipboard = true;
            this._clipboard.show('open');
            this._clipboard.focus();
            break;
          case true:
            this._clipboard.hide();
            break;
        }
      }
    });
  }

  openClipboard() {
    this.showClipboard = true;
    this._clipboard.show('open');
    this._clipboard.focus();
  }

  closeClipboard() {
    this.showClipboard = false;
    this._clipboard.hide();
  }

  toggleClipboard() {
    switch (this.showClipboard) {
      case true:
        this.closeClipboard();
        break;
      case false:
        this.openClipboard();
        break;
    }
  }

  // disconnectedCallback(): void {
  //   if (this._unlisten) this._unlisten();
  // }

  displayGroupHome() {
    return this.dashboardState.viewType === 'group' && !this.dashboardState.appletHash;
  }

  async openGroup(groupDnaHash: DnaHash) {
    this.dashboardState = {
      viewType: 'group',
      groupHash: groupDnaHash,
    };
    this._showTabView = false;
    // this.dynamicLayout.openTab({
    //   id: `group-home-${encodeHashToBase64(groupDnaHash)}`,
    //   type: "component",
    //   componentType: "group-home",
    //   componentState: {
    //     groupDnaHash: encodeHashToBase64(groupDnaHash),
    //   },
    // });
  }

  renderDashboard() {
    return html`
      ${this._openApplets.map((appletId) => {
        const appletHash = decodeHashFromBase64(appletId);
        return html`<applet-main
          .appletHash=${appletHash}
          style="flex: 1; ${this.displayApplet(appletId) ? '' : 'display: none'}"
        ></applet-main>`;
      })}
      ${this.dashboardState.viewType === 'group' && !this.dashboardState.appletHash
        ? html`
            <group-context .groupDnaHash=${this.dashboardState.groupHash}>
              <group-home
                style="flex: 1; ${this.displayGroupHome() ? '' : 'display: none'}"
                @group-left=${() => {
                  this.dashboardState = { viewType: 'personal' };
                }}
                @applet-selected=${(e: CustomEvent) => {
                  this.openViews.openAppletMain(e.detail.appletHash);
                  this._showTabView = false;
                }}
                @custom-view-selected=${(e) => {
                  throw new Error('Displaying custom views is currently not implemented.');
                }}
                @custom-view-created=${(e) => {
                  throw new Error('Displaying custom views is currently not implemented.');
                }}
              ></group-home>
            </group-context>
          `
        : html``}
    `;
  }

  renderOpenTabs() {
    const allOpenTabs = Object.values(this._openTabs);
    if (allOpenTabs.length === 0) {
      return html`<div class="column center-content" style="display: flex; flex: 1;">
        <div style="font-size: 40px; font-weight: bold; margin-bottom: 60px;">Entry Viewer</div>
        <div style="font-size: 20px; max-width: 800px; text-align: center;">
          This is where attachments and other entries are displayed. Opening an attachment in one of
          your applets will create a new tab here.<br /><br />
          Click on the
          <sl-icon
            .src=${wrapPathInSvg(mdiTableRow)}
            style="font-size: 34px; margin-bottom: -10px;"
          ></sl-icon>
          icon or on any group or applet to close the Entry Viewer again.<br /><br />
          If you are looking an attachment, red indicators show you the group(s) and applet(s) this
          specific attachment belongs to:
        </div>
        <div class="column" style="margin-top: 20px;">
          <div
            style="position: absolute; height: 7px; border-radius: 7px 7px 0 0; width: 32px; background: #f9502e;"
          ></div>
        </div>
      </div>`;
    }
    return allOpenTabs.map((tab) => {
      return html`
        <div
          class="column"
          style="display: flex; flex: 1; align-items: center; justify-content: center; ${this
            ._selectedTab && this._selectedTab.id === tab.id
            ? ''
            : 'display: none;'}"
        >
          ${this.renderTabContent(tab)}
        </div>
      `;
    });
  }

  renderTabContent(info: TabInfo) {
    switch (info.tab.type) {
      case 'hrl':
        return html`<entry-view
          @jump-to-applet=${(e) => {
            this.openViews.openAppletMain(e.detail);
            this._showTabView = false;
          }}
          .hrl=${[info.tab.hrl.hrl[0], info.tab.hrl.hrl[1]]}
          .context=${info.tab.hrl.context}
          style="display: flex; flex: 1;"
        ></entry-view>`;
      case 'html':
        return info.tab.template;
      default:
        return html`Invalid tab type.`;
    }
  }

  renderCloseTab(tabId: string) {
    return html`
      <div
        class="close-tab-button"
        tabindex="0"
        @click=${async (e) => {
          e.stopPropagation();
          const openTabs = Object.values(this._openTabs);
          const nextOpenTab = openTabs.length > 1 ? openTabs[openTabs.length - 2] : undefined;
          delete this._openTabs[tabId];
          if (nextOpenTab) {
            this._selectedTab = nextOpenTab;
            this._showTabView = true;
          } else {
            this._showTabView = false;
          }
        }}
        @keypress=${async (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.stopPropagation();
            const openTabs = Object.values(this._openTabs);
            const nextOpenTab = openTabs.length > 1 ? openTabs[openTabs.length - 2] : undefined;
            delete this._openTabs[tabId];
            if (nextOpenTab) {
              this._selectedTab = nextOpenTab;
              this._showTabView = true;
            } else {
              this._showTabView = false;
            }
          }
        }}
      >
        ×
      </div>
    `;
  }

  renderEntryTabBar() {
    const openTabs = Object.values(this._openTabs);
    if (openTabs.length === 0) {
      return html`<span style="margin-left: 10px; font-size: 20px;">No open tabs...</span>`;
    }
    return openTabs.map((tabInfo) => {
      switch (tabInfo.tab.type) {
        case 'hrl':
          return html`
            <div
              class="entry-tab row ${this._selectedTab && this._selectedTab.id === tabInfo.id
                ? 'tab-selected'
                : ''}"
              style="align-items: center; padding-left: 8px;"
              tabindex="0"
              @click=${async (e) => {
                e.stopPropagation();
                this._selectedTab = tabInfo;
                this._showTabView = true;
              }}
              @keypress=${async (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  e.stopPropagation();
                  this._selectedTab = tabInfo;
                  this._showTabView = true;
                }
              }}
            >
              ${this.renderCloseTab(tabInfo.id)}
              <entry-title .hrl=${[tabInfo.tab.hrl.hrl[0], tabInfo.tab.hrl.hrl[1]]}></entry-title>
            </div>
          `;
        case 'html':
          return html`
            <div
              class="entry-tab row ${this._selectedTab && this._selectedTab.id === tabInfo.id
                ? 'tab-selected'
                : ''}"
              style="align-items: center; padding-left: 8px;"
              tabindex="0"
              @click=${async (e) => {
                e.stopPropagation();
                this._selectedTab = tabInfo;
              }}
              @keypress=${async (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  e.stopPropagation();
                  this._selectedTab = tabInfo;
                }
              }}
            >
              ${this.renderCloseTab(tabInfo.id)}
              <span>${tabInfo.tab.title}</span>
            </div>
          `;
      }
    });
  }

  render() {
    return html`
      <we-clipboard
        id="clipboard"
        @open-hrl=${async (e) => {
          const hrlWithContext = e.detail.hrlWithContext;
          const hrl = hrlWithContext.hrl;
          const alreadyOpen = Object.values(this._openTabs).find(
            (tabInfo) =>
              tabInfo.tab.type === 'hrl' &&
              JSON.stringify(tabInfo.tab.hrl) === JSON.stringify(hrlWithContext),
          );
          if (alreadyOpen) {
            this.openTab(alreadyOpen);
            return;
          }
          const tabId = `hrl://${encodeHashToBase64(hrl[0])}/${encodeHashToBase64(hrl[1])}`;
          const [groupContextHashesB64, appletContextIds] =
            await this.getRelatedGroupsAndApplets(hrl);
          const tabInfo: TabInfo = {
            id: tabId,
            tab: {
              type: 'hrl',
              hrl: hrlWithContext,
              groupHashesB64: groupContextHashesB64,
              appletIds: appletContextIds,
            },
          };
          this.openTab(tabInfo);
        }}
        @hrl-selected=${(e) => {
          this.dispatchEvent(
            new CustomEvent('hrl-selected', {
              detail: e.detail,
              bubbles: false,
              composed: false,
            }),
          );
        }}
        @sl-hide=${() => {
          this.dispatchEvent(
            new CustomEvent('cancel-select-hrl', {
              bubbles: false,
              composed: false,
            }),
          );
          this.showClipboard = false;
        }}
      ></we-clipboard>
      <join-group-dialog
        @group-joined=${(e) => this.openGroup(e.detail.groupDnaHash)}
      ></join-group-dialog>

      <create-group-dialog
        id="create-group-dialog"
        @group-created=${(e: CustomEvent) => {
          this.openGroup(e.detail.groupDnaHash);
        }}
      ></create-group-dialog>

      <div class="group-viewer invisible-scrollbars">
        <!-- PERSONAL VIEW -->
        ${this.dashboardState.viewType === 'personal'
          ? html` <welcome-view
              style="display: flex; flex: 1;"
              @open-appstore=${() => this.openAppStore()}
              @request-create-group=${() =>
                (
                  this.shadowRoot?.getElementById('create-group-dialog') as CreateGroupDialog
                ).open()}
              @request-join-group=${(_e) => this.joinGroupDialog.open()}
            ></welcome-view>`
          : html``}

        <!-- GROUP VIEW -->
        <div
          style="${this.dashboardState.viewType === 'group'
            ? 'display: flex; flex: 1;'
            : 'display: none;'}"
        >
          ${this.renderDashboard()}
        </div>
      </div>

      <!-- TABS VIEW -->
      <div
        class="entry-viewer slide-in-right slide-out-right ${this._showTabView ? 'show' : 'hide'}"
      >
        ${this.renderOpenTabs()}
      </div>

      <!-- LEFT SIDEBAR -->
      <div
        class="column"
        style="position: fixed; left: 0; top: 0; bottom: 0; background: var(--sl-color-primary-900);"
      >
        <div
          class="column top-left-corner ${this.dashboardState.viewType === 'personal'
            ? 'selected'
            : ''}"
        >
          <sidebar-button
            style="--size: 58px; --border-radius: 20px; --hover-color: transparent;"
            .selected=${false}
            .logoSrc=${weLogoIcon}
            .tooltipText=${msg('Browser View')}
            placement="bottom"
            tabindex="0"
            @click=${() => {
              this.dashboardState = { viewType: 'personal' };
              this._showTabView = false;
            }}
            @keypress=${(e: KeyboardEvent) => {
              if (e.key === 'Enter') {
                this.dashboardState = { viewType: 'personal' };
                this._showTabView = false;
              }
            }}
          ></sidebar-button>
        </div>

        <groups-sidebar
          class="left-sidebar"
          .selectedGroupDnaHash=${this.dashboardState.viewType === 'group'
            ? this.dashboardState.groupHash
            : undefined}
          .indicatedGroupDnaHashes=${this._showTabView &&
          this._selectedTab &&
          this._selectedTab.tab.type === 'hrl'
            ? this._selectedTab.tab.groupHashesB64
            : []}
          @group-selected=${(e: CustomEvent) => {
            this.openGroup(e.detail.groupDnaHash);
          }}
          @request-create-group=${() =>
            (this.shadowRoot?.getElementById('create-group-dialog') as CreateGroupDialog).open()}
        ></groups-sidebar>

        <span style="display: flex; flex: 1;"></span>

        <!-- TAB BAR BUTTON -->
        <div
          class="entry-tab-bar-button ${this._showTabView ? 'btn-selected' : ''}"
          tabindex="0"
          @click=${() => {
            this._showTabView = !this._showTabView;
          }}
          @keypress=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              this._showTabView = !this._showTabView;
            }
          }}
        >
          <sl-icon .src=${wrapPathInSvg(mdiTableRow)} style="font-size: 34px;"></sl-icon>
        </div>
      </div>

      <!-- TOP BAR -->
      <div
        class="top-bar row"
        style="flex: 1; position: fixed; left: var(--sidebar-width); top: 0; right: 0;"
      >
        ${this.dashboardState.viewType === 'group'
          ? html`
              <group-context .groupDnaHash=${this.dashboardState.groupHash}>
                <group-applets-sidebar
                  .selectedAppletHash=${this.dashboardState.appletHash}
                  .indicatedAppletHashes=${this._showTabView &&
                  this._selectedTab &&
                  this._selectedTab.tab.type === 'hrl'
                    ? this._selectedTab.tab.appletIds
                    : []}
                  @applet-selected=${(e: {
                    detail: { appletHash: AppletHash; groupDnaHash: DnaHash };
                  }) => {
                    const appletId = encodeHashToBase64(e.detail.appletHash);
                    if (!this._openApplets.includes(appletId)) {
                      this._openApplets.push(appletId);
                    }
                    this.dashboardState = {
                      viewType: 'group',
                      groupHash: e.detail.groupDnaHash,
                      appletHash: e.detail.appletHash,
                    };
                    this._showTabView = false;
                  }}
                  style="margin-left: 12px; flex: 1; overflow-x: sroll;"
                ></group-applets-sidebar>
              </group-context>
            `
          : html`<div style="font-size: 28px; margin-left: 20px;">Home</div>`}
      </div>

      <!-- BOTTOM BAR -->
      <div
        class="entry-view-bar"
        style="${this._showTabView
          ? ''
          : 'display: none;'} position: fixed; bottom: 0; left: 74px; right: 0;"
      >
        ${this.renderEntryTabBar()}
      </div>

      <sl-button
        variant="success"
        style="margin-right: 8px; margin-top: 8px; position: fixed; top: 0; right: 0; font-size: 18px;"
        @click=${() => this.openClipboard()}
        @keypress.enter=${() => this.openClipboard()}
      >
        <div class="row" style="align-items: center; font-size: 18px;">
          <sl-icon .src=${wrapPathInSvg(mdiMagnify)} style="font-size: 24px;"></sl-icon>
          <span style="margin-left: 10px;">${msg('Search')}</span>
        </div>
      </sl-button>
    `;
  }

  static get styles() {
    return [
      weStyles,
      css`
        :host {
          flex: 1;
          display: flex;
        }

        .top-left-corner {
          align-items: center;
          justify-content: center;
          background: var(--sl-color-primary-900);
          height: var(--sidebar-width);
          border-radius: 25px 25px 0 0;
        }

        .top-left-corner:hover {
          border-radius: 25px 0 0 25px;
          background: var(--sl-color-primary-600);
        }

        .hover-browser {
          flex: 1;
          position: fixed;
          left: var(--sidebar-width);
          top: 0;
          right: 0;
          background: var(--sl-color-primary-200);
          height: var(--sidebar-width);
        }

        .entry-viewer {
          display: flex;
          flex: 1;
          position: fixed;
          top: 79px;
          left: 79px;
          bottom: 50px;
          right: 0;
          background: white;
          box-shadow: 0 0 2px 1px #000000;
          border-radius: 20px 0 0 0;
          border-top: 4px solid var(--sl-color-primary-400);
          border-left: 4px solid var(--sl-color-primary-400);
        }

        .group-viewer {
          display: flex;
          flex: 1;
          position: fixed;
          top: 74px;
          left: 74px;
          bottom: 0;
          right: 0;
          background: white;
          overflow-y: auto;
        }

        .invisible-scrollbars {
          -ms-overflow-style: none; /* IE and Edge */
          scrollbar-width: none; /* Firefox */
        }

        .invisible-scrollbars::-webkit-scrollbar {
          display: none;
        }

        .selected {
          border-radius: 25px 0 0 25px;
          background-color: var(--sl-color-primary-600);
        }

        .close-tab-button {
          font-size: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: row;
          height: 20px;
          width: 20px;
          position: absolute;
          right: 5px;
          border-radius: 3px;
        }

        .close-tab-button:hover {
          background: var(--sl-color-primary-800);
          color: var(--sl-color-primary-50);
        }

        .entry-view-bar {
          display: flex;
          align-items: center;
          padding-left: 5px;
          height: 50px;
          background: var(--sl-color-primary-200);
        }

        .entry-tab {
          height: 40px;
          width: 200px;
          background: var(--sl-color-primary-400);
          border-radius: 4px;
          margin-right: 5px;
          padding-left: 4px;
          cursor: default;
          position: relative;
        }

        .entry-tab:hover {
          background: var(--sl-color-primary-50);
        }

        .tab-selected {
          background: var(--sl-color-primary-50);
          box-shadow: 0 0 3px #808080;
        }

        .entry-tab-bar-button {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: row;
          color: black;
          background: var(--sl-color-primary-200);
          cursor: pointer;
          margin: 5px;
          border-radius: 5px;
          height: 40px;
        }

        .entry-tab-bar-button:hover {
          margin: 0;
          border-radius: 5px 0 0 5px;
          height: 50px;
        }

        .btn-selected {
          margin: 0;
          border-radius: 5px 0 0 5px;
          height: 50px;
        }

        .tab-bar-active {
          background: #d66969;
        }

        .open-tab-btn {
          background: var(--sl-color-primary-900);
          font-weight: 600;
          color: white;
          height: 40px;
          align-items: center;
          padding: 0 8px;
          border-radius: 4px;
          cursor: pointer;
        }

        .open-tab-btn:hover {
          background: var(--sl-color-primary-600);
        }

        .left-sidebar {
          background-color: var(--sl-color-primary-900);
          width: var(--sidebar-width);
          display: flex;
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          -ms-overflow-style: none; /* IE and Edge */
          scrollbar-width: none; /* Firefox */
        }

        .left-sidebar::-webkit-scrollbar {
          display: none;
        }

        .top-bar {
          background-color: var(--sl-color-primary-600);
          min-height: var(--sidebar-width);
          align-items: center;
          overflow-x: auto;
          -ms-overflow-style: none; /* IE and Edge */
          scrollbar-width: none; /* Firefox */
        }

        .top-bar::-webkit-scrollbar {
          display: none;
        }

        .slide-in-right {
          transform: translateX(100%);
          transition:
            opacity 0.15s ease-out,
            transform 0.15s ease-out;
        }

        .slide-in-right.show {
          transform: translateX(0);
        }

        .slide-out-right {
          transform: translateX(0);
          transition:
            opacity 0.15s ease-out,
            transform 0.15s ease-out;
        }

        .slide-out-right.hide {
          transform: translateX(100%);
        }
      `,
    ];
  }
}

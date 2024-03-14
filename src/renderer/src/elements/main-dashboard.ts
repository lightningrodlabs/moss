import { consume, provide } from '@lit/context';
import { classMap } from 'lit/directives/class-map.js';
import { state, customElement, query, property } from 'lit/decorators.js';
import { encodeHashToBase64, DnaHash, decodeHashFromBase64, DnaHashB64 } from '@holochain/client';
import { LitElement, html, css, TemplateResult } from 'lit';
import {
  StoreSubscriber,
  asyncDeriveStore,
  joinAsyncMap,
  toPromise,
} from '@holochain-open-dev/stores';
import { Hrl, mapValues } from '@holochain-open-dev/utils';
import { notifyError, wrapPathInSvg } from '@holochain-open-dev/elements';
import { msg } from '@lit/localize';
import { mdiMagnify, mdiViewGalleryOutline } from '@mdi/js';
import {
  AppletHash,
  AppletId,
  HrlWithContext,
  OpenHrlMode,
  WeaveLocation,
  weaveUrlToLocation,
} from '@lightningrodlabs/we-applet';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@lightningrodlabs/we-elements/dist/elements/we-client-context.js';
import '@lightningrodlabs/we-elements/dist/elements/hrl-to-clipboard.js';

import '../layout/views/welcome-view.js';
import '../groups/elements/entry-title.js';
import './groups-sidebar.js';
import './group-applets-sidebar.js';
import './join-group-dialog.js';
import '../layout/views/applet-main.js';
import '../layout/views/appstore-view.js';
import '../layout/views/publishing-view.js';
import '../layout/views/attachable-view.js';
import '../groups/elements/group-home.js';
import '../elements/zome-call-panel.js';

import { weStyles } from '../shared-styles.js';
import { weStoreContext } from '../context.js';
import { WeStore } from '../we-store.js';
import { JoinGroupDialog } from './join-group-dialog.js';
import { CreateGroupDialog } from './create-group-dialog.js';

import './clipboard.js';
import './creatable-panel.js';
import { WeClipboard } from './clipboard.js';
import { CreatablePanel } from './creatable-panel.js';
import { setupAppletMessageHandler } from '../applets/applet-host.js';
import { openViewsContext } from '../layout/context.js';
import { AppOpenViews } from '../layout/types.js';
import { decodeContext, getAllIframes, stringifyHrlWithContext } from '../utils.js';
import { getAppVersion } from '../electron-api.js';

type OpenTab =
  | {
      type: 'hrl';
      hrlWithContext: HrlWithContext;
      groupHashesB64: DnaHashB64[];
      appletIds: AppletId[];
    }
  | {
      type: 'html';
      template: TemplateResult;
      title: string;
      icon?: string;
    }
  | {
      type: 'not found';
    };

export type TabInfo = {
  id: string;
  tab: OpenTab;
};

export type DashboardState =
  | {
      viewType: 'personal';
    }
  | { viewType: 'group'; groupHash: DnaHash; appletHash?: AppletHash };

export type AttachableViewerState = {
  position: 'front' | 'side';
  visible: boolean;
};

@customElement('main-dashboard')
export class MainDashboard extends LitElement {
  @consume({ context: weStoreContext })
  @state()
  _weStore!: WeStore;

  @query('join-group-dialog')
  joinGroupDialog!: JoinGroupDialog;

  @query('#clipboard')
  _clipboard!: WeClipboard;

  @query('#creatable-panel')
  _creatablePanel!: CreatablePanel;

  @state()
  appVersion: string | undefined;

  @state()
  _drawerWidth: number = 380;

  @state()
  _drawerResizing = false;

  @state()
  _resizeDrawerX: number | null = null;

  @state()
  showClipboard: boolean = false;

  @state()
  showCreatablePanel: boolean = false;

  @state()
  _openTabs: Record<string, TabInfo> = {}; // open tabs by id

  @state()
  _openGroups: DnaHash[] = [];

  @state()
  _selectedTab: TabInfo | undefined;

  _dashboardState = new StoreSubscriber(
    this,
    () => this._weStore.dashboardState(),
    () => [this._weStore],
  );

  _attachableViewerState = new StoreSubscriber(
    this,
    () => this._weStore.attachableViewerState(),
    () => [this._weStore],
  );

  _allGroupHashes = new StoreSubscriber(
    this,
    () => this._weStore.groupsDnaHashes,
    () => [this._weStore],
  );

  _runningApplets = new StoreSubscriber(
    this,
    () => this._weStore.runningApplets,
    () => [this._weStore],
  );

  // _unlisten: UnlistenFn | undefined;

  @provide({ context: openViewsContext })
  @property()
  openViews: AppOpenViews = {
    openAppletMain: async (appletHash) => {
      const groupsForApplet = await toPromise(this._weStore.groupsForApplet.get(appletHash));
      const groupDnaHashes = Array.from(groupsForApplet.keys());
      if (groupDnaHashes.length === 0) {
        notifyError('Applet not found in any of your groups.');
        throw new Error('Applet not found in any of the groups.');
      }
      // pick an arbitrary group this applet is installed in
      const groupDnaHash = groupDnaHashes[0];
      this._weStore.setDashboardState({
        viewType: 'group',
        groupHash: groupDnaHash,
        appletHash,
      });
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
    openHrl: async (hrlWithContext: HrlWithContext, mode?: OpenHrlMode) => {
      const tabId = stringifyHrlWithContext(hrlWithContext);
      try {
        const [groupContextHashesB64, appletContextIds] = await this.getRelatedGroupsAndApplets(
          hrlWithContext.hrl,
        );
        const tabInfo: TabInfo = {
          id: tabId,
          tab: {
            type: 'hrl',
            hrlWithContext,
            groupHashesB64: groupContextHashesB64,
            appletIds: appletContextIds,
          },
        };
        this.openTab(tabInfo, mode);
      } catch (e) {
        console.error(e);
        this.openTab({
          id: Date.now().toString(),
          tab: {
            type: 'not found',
          },
        });
      }
    },
    userSelectHrl: async () => {
      this._clipboard.show('select');

      return new Promise((resolve) => {
        const listener = (e) => {
          switch (e.type) {
            case 'cancel-select-hrl':
              this.removeEventListener('cancel-select-hrl', listener);
              return resolve(undefined);
            case 'hrl-selected':
              const hrlWithContext: HrlWithContext = e.detail.hrlWithContext;
              this.removeEventListener('hrl-selected', listener);
              this._clipboard.hide();
              return resolve(hrlWithContext);
          }
        };
        this.addEventListener('hrl-selected', listener);
        this.addEventListener('cancel-select-hrl', listener);
      });
    },
    toggleClipboard: () => this.toggleClipboard(),
  };

  displayApplet(appletHash: AppletHash) {
    return (
      this._dashboardState.value.viewType === 'group' &&
      this._dashboardState.value.appletHash &&
      this._dashboardState.value.appletHash.toString() === appletHash.toString()
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
        title: 'Applet Library',
        template: html`
          <appstore-view
            style="display: flex; flex: 1;"
            @open-publishing-view=${() => this.openPublishingView()}
            @applet-installed=${(e: {
              detail: {
                appletEntryHash: AppletHash;
                groupDnaHash: DnaHash;
              };
            }) => {
              this._weStore.setDashboardState({
                viewType: 'group',
                groupHash: e.detail.groupDnaHash,
                appletHash: e.detail.appletEntryHash,
              });
              if (this._attachableViewerState.value.position === 'front') {
                this._weStore.setAttachableViewerState({ position: 'front', visible: false });
              }
            }}
          ></appstore-view>
        `,
      },
    };
    this._weStore.setAttachableViewerState({ position: 'front', visible: true });
    this.openTab(tabInfo);
  }

  openZomeCallPanel() {
    const tabId = 'zome-call-panel';
    const tabInfo: TabInfo = {
      id: tabId,
      tab: {
        type: 'html',
        title: 'Zome Call Panel',
        template: html` <zome-call-panel></zome-call-panel> `,
      },
    };
    this._weStore.setAttachableViewerState({ position: 'front', visible: true });
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

  async openTab(tabInfo: TabInfo, mode?: OpenHrlMode) {
    const alreadyOpen = Object.values(this._openTabs).find(
      (tabInfoExisting) => tabInfo.id === tabInfoExisting.id,
    );
    if (!alreadyOpen) {
      this._openTabs[tabInfo.id] = tabInfo;
    }
    // In order to be able to show the indicators about which applet
    // this HRL belongs to, the applets bar needs to actually be there,
    // i.e. we need to switch to group view if we haven't yet
    if (
      this._dashboardState.value.viewType === 'personal' &&
      tabInfo.tab.type === 'hrl' &&
      tabInfo.tab.groupHashesB64.length > 0
    ) {
      const groupDnaHash = decodeHashFromBase64(tabInfo.tab.groupHashesB64[0]);
      this.openGroup(groupDnaHash);
      this._dashboardState.value = {
        viewType: 'group',
        groupHash: groupDnaHash,
      };
    }
    this._weStore.setAttachableViewerState({
      position: mode ? mode : this._attachableViewerState.value.position,
      visible: true,
    });
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

  async handleOpenHrl(hrlWithContext: HrlWithContext) {
    const hrl = hrlWithContext.hrl;
    const alreadyOpen = Object.values(this._openTabs).find(
      (tabInfo) =>
        tabInfo.tab.type === 'hrl' &&
        JSON.stringify(tabInfo.tab.hrlWithContext) === JSON.stringify(hrlWithContext),
    );
    if (alreadyOpen) {
      this.openTab(alreadyOpen);
      return;
    }
    const tabId = `hrl://${encodeHashToBase64(hrl[0])}/${encodeHashToBase64(hrl[1])}`;
    try {
      const [groupContextHashesB64, appletContextIds] = await this.getRelatedGroupsAndApplets(hrl);
      const tabInfo: TabInfo = {
        id: tabId,
        tab: {
          type: 'hrl',
          hrlWithContext,
          groupHashesB64: groupContextHashesB64,
          appletIds: appletContextIds,
        },
      };
      this.openTab(tabInfo);
    } catch (e) {
      this.openTab({
        id: Date.now().toString(),
        tab: {
          type: 'not found',
        },
      });
    }
  }

  async handleOpenWurl(wurl: string) {
    let weaveLocation: WeaveLocation | undefined;
    try {
      weaveLocation = weaveUrlToLocation(wurl);
    } catch (e) {
      notifyError('Invalid URL');
      console.error(e);
      return;
    }
    if (!weaveLocation) {
      notifyError('Failed to parse URL');
    } else {
      switch (weaveLocation.type) {
        case 'applet':
          return this.handleOpenAppletMain(weaveLocation.appletHash);
        case 'group':
          // TODO fix after renaming of group links to invite links
          notifyError('URL type not supported.');
          return;
        case 'invitation':
          // TODO implement after renaming of group links to invite links
          notifyError('URL type not supported.');
          return;
        case 'asset':
          return this.handleOpenHrl(weaveLocation.hrlWithContext);
      }
    }
  }

  async handleOpenAppletMain(appletHash: AppletHash) {
    this.openViews.openAppletMain(appletHash);
    if (this._attachableViewerState.value.position === 'front') {
      this._weStore.setAttachableViewerState({ position: 'front', visible: false });
    }
  }

  async firstUpdated() {
    setupAppletMessageHandler(this._weStore, this.openViews);
    window.electronAPI.onSwitchToApplet((_, appletId) => {
      if (appletId) {
        this.openViews.openAppletMain(decodeHashFromBase64(appletId));
        if (this._attachableViewerState.value.position === 'front') {
          this._weStore.setAttachableViewerState({ position: 'front', visible: false });
        }
      }
    });

    window.electronAPI.onDeepLinkReceived(async (_, deepLink) => {
      console.log('Received deeplink: ', deepLink);
      try {
        const split = deepLink.split('://');
        // ['we', 'hrl/uhC0k-GO_J2D51Ibh2jKjVJHAHPadV7gndBwrqAmDxRW3b…kzMgM3yU2RkmaCoiY8IVcUQx_TLOjJe8SxJVy7iIhoVIvlZrD']
        const split2 = split[1].split('/');
        // ['hrl', 'uhC0k-GO_J2D51Ibh2jKjVJHAHPadV7gndBwrqAmDxRW3buMpVRa9', 'uhCkkzMgM3yU2RkmaCoiY8IVcUQx_TLOjJe8SxJVy7iIhoVIvlZrD']

        console.log('split 1: ', split);
        console.log('split 2: ', split2);

        if (split2[0] === 'hrl') {
          const contextSplit = split2[2].split('?context=');
          console.log('contextSplit', contextSplit);
          await this.handleOpenHrl({
            hrl: [decodeHashFromBase64(split2[1]), decodeHashFromBase64(contextSplit[0])],
            context: contextSplit[1] ? decodeContext(contextSplit[1]) : undefined,
          });
        } else if (split2[0] === 'group') {
          await this.handleOpenGroup(split2[1]);
        } else if (split2[0] === 'applet') {
          await this.handleOpenAppletMain(decodeHashFromBase64(split2[1]));
        }
      } catch (e) {
        console.error(e);
        // notifyError(msg('Error opening the link.'));
      }
    });

    // add event listener to close attachable viewer when clicking outside of it
    document.addEventListener('click', () => {
      if (this._attachableViewerState.value.position === 'front') {
        this._weStore.setAttachableViewerState({ position: 'front', visible: false });
      }
    });

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

    this.appVersion = await getAppVersion();
  }

  openClipboard() {
    this.showClipboard = true;
    this._clipboard.show('open');
    this._clipboard.focus();
  }

  openCreatablePanel() {
    this.showCreatablePanel = true;
    this._creatablePanel.show();
    this._creatablePanel.focus();
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

  resizeMouseDownHandler(e: MouseEvent) {
    document.body.style.cursor = 'col-resize';
    this._drawerResizing = true;
    this._resizeDrawerX = e.clientX;
    this.addEventListener('mousemove', this.resizeMouseMoveHandler);
    this.addEventListener('mouseup', this.resizeMouseUpHandler);
    console.log('this._resizeDrawerX: ', this._resizeDrawerX);
  }

  resizeMouseMoveHandler(e: MouseEvent) {
    // console.log('mousemove event: ', e);
    // console.log('@mousemove: this._drawerWidth: ', this._drawerWidth);
    if (this._resizeDrawerX) {
      const deltaX = this._resizeDrawerX - e.clientX;
      this._drawerWidth = this._drawerWidth + deltaX;
      // console.log('New drawer width: ', this._drawerWidth);
    }
    this._resizeDrawerX = e.clientX;
  }

  resizeMouseUpHandler(_e: MouseEvent) {
    document.body.style.removeProperty('cursor');
    this.removeEventListener('mousemove', this.resizeMouseMoveHandler);
    this.removeEventListener('mouseup', this.resizeMouseUpHandler);
    this._drawerResizing = false;
  }

  // disconnectedCallback(): void {
  //   if (this._unlisten) this._unlisten();
  // }

  displayGroupHome(groupHash: DnaHash) {
    return (
      this._dashboardState.value.viewType === 'group' &&
      !this._dashboardState.value.appletHash &&
      this._dashboardState.value.groupHash.toString() === groupHash.toString()
    );
  }

  async openGroup(groupDnaHash: DnaHash) {
    if (
      !this._openGroups
        .map((hash) => encodeHashToBase64(hash))
        .includes(encodeHashToBase64(groupDnaHash))
    ) {
      this._openGroups.push(groupDnaHash);
    }
    this._weStore.setDashboardState({
      viewType: 'group',
      groupHash: groupDnaHash,
    });
    if (this._attachableViewerState.value.position === 'front') {
      this._weStore.setAttachableViewerState({ position: 'front', visible: false });
    }
    // this.dynamicLayout.openTab({
    //   id: `group-home-${encodeHashToBase64(groupDnaHash)}`,
    //   type: "component",
    //   componentType: "group-home",
    //   componentState: {
    //     groupDnaHash: encodeHashToBase64(groupDnaHash),
    //   },
    // });
  }

  renderAppletMainViews() {
    switch (this._runningApplets.value.status) {
      case 'pending':
        return html`Loading running applets...`;
      case 'error':
        return html`Failed to get running applets: ${this._runningApplets.value.error}`;
      case 'complete':
        return html`
          ${this._runningApplets.value.value.map((appletHash) => {
            return html`<applet-main
              .appletHash=${appletHash}
              style="flex: 1; ${this.displayApplet(appletHash) ? '' : 'display: none'}"
            ></applet-main>`;
          })}
        `;
    }
  }

  renderDashboard() {
    return html`
      ${this.renderAppletMainViews()}
      ${this._openGroups.map(
        (groupHash) => html`
          <group-context .groupDnaHash=${groupHash}>
            <group-home
              style="flex: 1; position: relative; ${this.displayGroupHome(groupHash)
                ? ''
                : 'display: none'}"
              @group-left=${() => {
                this._weStore.setDashboardState({ viewType: 'personal' });
              }}
              @applet-selected=${(e: CustomEvent) => {
                this.openViews.openAppletMain(e.detail.appletHash);
                if (this._attachableViewerState.value.position === 'front') {
                  this._weStore.setAttachableViewerState({ position: 'front', visible: false });
                }
              }}
              @applet-installed=${(e: {
                detail: {
                  appletEntryHash: AppletHash;
                  groupDnaHash: DnaHash;
                };
              }) => {
                this._weStore.setDashboardState({
                  viewType: 'group',
                  groupHash: e.detail.groupDnaHash,
                  appletHash: e.detail.appletEntryHash,
                });
                if (this._attachableViewerState.value.position === 'front') {
                  this._weStore.setAttachableViewerState({ position: 'front', visible: false });
                }
              }}
              @custom-view-selected=${(_e) => {
                throw new Error('Displaying custom views is currently not implemented.');
              }}
              @custom-view-created=${(_e) => {
                throw new Error('Displaying custom views is currently not implemented.');
              }}
            ></group-home>
          </group-context>
        `,
      )}
    `;
  }

  renderOpenTabs() {
    const allOpenTabs = Object.values(this._openTabs);
    if (allOpenTabs.length === 0) {
      return html`<div class="column center-content" style="display: flex; flex: 1;">
        <div style="font-size: 40px; font-weight: bold; margin-bottom: 60px; text-align: center;">
          Attachable Viewer
        </div>
        <div style="font-size: 20px; max-width: 800px; text-align: center;">
          This is where attachables are displayed. Opening an attachable from one of your applets
          will create a new tab here.<br /><br />
          If you are looking at an attachable, green indicators show you the group(s) and applet(s)
          the specific attachable belongs to:
        </div>
        <div class="column" style="margin-top: 20px;">
          <div
            style="position: absolute; height: 7px; border-radius: 7px 7px 0 0; width: 32px; background: var(--sl-color-tertiary-200);"
          ></div>
        </div>
      </div>`;
    }
    return allOpenTabs.map((tab) => {
      return html`
        <div
          class="column"
          style="display: flex; flex: 1; ${this._selectedTab && this._selectedTab.id === tab.id
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
        return html`<attachable-view
          @jump-to-applet=${(e) => {
            this.openViews.openAppletMain(e.detail);
            if (this._attachableViewerState.value.position === 'front') {
              this._weStore.setAttachableViewerState({ position: 'front', visible: false });
            }
          }}
          .hrlWithContext=${info.tab.hrlWithContext}
          style="display: flex; flex: 1;"
        ></attachable-view>`;
      case 'html':
        return info.tab.template;
      case 'not found':
        return html`<div
          class="column center-content"
          style="font-size: 40px; font-weight: bold; flex: 1;"
        >
          404 -Not Found
        </div>`;
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
            this._weStore.setAttachableViewerState({
              position: this._attachableViewerState.value.position,
              visible: true,
            });
          } else {
            this._weStore.setAttachableViewerState({
              position: this._attachableViewerState.value.position,
              visible: false,
            });
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
              this._weStore.setAttachableViewerState({
                position: this._attachableViewerState.value.position,
                visible: true,
              });
            } else {
              this._weStore.setAttachableViewerState({
                position: this._attachableViewerState.value.position,
                visible: false,
              });
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
      return html`<span style="margin-left: 10px; font-size: 20px;">No open entries...</span>`;
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
                this._weStore.setAttachableViewerState({
                  position: this._attachableViewerState.value.position,
                  visible: true,
                });
              }}
              @keypress=${async (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  e.stopPropagation();
                  this._selectedTab = tabInfo;
                  this._weStore.setAttachableViewerState({
                    position: this._attachableViewerState.value.position,
                    visible: true,
                  });
                }
              }}
            >
              ${this.renderCloseTab(tabInfo.id)}
              <entry-title .hrlWithContext=${tabInfo.tab.hrlWithContext}></entry-title>
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
        case 'not found':
          return html` <div
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
            <span>404 - Not Found</span>
          </div>`;
      }
    });
  }

  render() {
    return html`
      <we-clipboard
        id="clipboard"
        @click=${(e) => e.stopPropagation()}
        @open-hrl=${async (e) => await this.handleOpenHrl(e.detail.hrlWithContext)}
        @open-wurl=${async (e) => await this.handleOpenWurl(e.detail.wurl)}
        @open-creatable-panel=${() => this._creatablePanel.show()}
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
      <creatable-panel
        id="creatable-panel"
        @click=${(e) => e.stopPropagation()}
        @open-hrl=${async (e) => await this.handleOpenHrl(e.detail.hrlWithContext)}
        @hrl-selected=${(e) => {
          this.dispatchEvent(
            new CustomEvent('hrl-selected', {
              detail: e.detail,
              bubbles: false,
              composed: false,
            }),
          );
        }}
      ></creatable-panel>
      <join-group-dialog
        @group-joined=${(e) => this.openGroup(e.detail.groupDnaHash)}
      ></join-group-dialog>

      <create-group-dialog
        id="create-group-dialog"
        @group-created=${(e: CustomEvent) => {
          this.openGroup(e.detail.groupDnaHash);
        }}
      ></create-group-dialog>

      <div class="group-viewer invisible-scrollbars column">
        <!-- PERSONAL VIEW -->
        <div
          class="row"
          style="flex: 1; ${this._attachableViewerState.value.visible
            ? 'max-height: calc(100vh - 124px);'
            : ''}"
        >
          <welcome-view
            id="welcome-view"
            @click=${(e) => e.stopPropagation()}
            style="${this._dashboardState.value.viewType === 'personal'
              ? 'display: flex; flex: 1;'
              : 'display: none;'}${this._drawerResizing
              ? 'pointer-events: none; user-select: none;'
              : ''}"
            @open-appstore=${() => this.openAppStore()}
            @request-create-group=${() =>
              (this.shadowRoot?.getElementById('create-group-dialog') as CreateGroupDialog).open()}
            @request-join-group=${(_e) => this.joinGroupDialog.open()}
            @applet-selected=${(e: CustomEvent) => {
              this.openViews.openAppletMain(e.detail.appletHash);
              if (this._attachableViewerState.value.position === 'front') {
                this._weStore.setAttachableViewerState({ position: 'front', visible: false });
              }
            }}
          ></welcome-view>

          <!-- GROUP VIEW -->
          <div
            id="group-view-area"
            style="${this._dashboardState.value.viewType === 'group'
              ? 'display: flex; flex: 1;'
              : 'display: none;'}${this._drawerResizing
              ? 'pointer-events: none; user-select: none;'
              : ''}"
          >
            ${this.renderDashboard()}
          </div>
          <div
            class="drawer-separator"
            style="${this._attachableViewerState.value.visible ? '' : 'display: none;'}"
            @mousedown=${(e) => {
              console.log('Got mousedown event: ', e);
              this.resizeMouseDownHandler(e);
            }}
          ></div>
          <div
            id="attachable-viewer"
            class="${classMap({
              'attachable-viewer': this._attachableViewerState.value.position === 'front',
              'slide-in-right': this._attachableViewerState.value.position === 'front',
              'slide-out-right': this._attachableViewerState.value.position === 'front',
              'side-drawer': this._attachableViewerState.value.position === 'side',
              hidden:
                !this._attachableViewerState.value.visible &&
                this._attachableViewerState.value.position === 'side',
              show:
                this._attachableViewerState.value.visible &&
                this._attachableViewerState.value.position === 'front',
              hide:
                !this._attachableViewerState.value.visible &&
                this._attachableViewerState.value.position === 'front',
            })}"
            style="${this._drawerResizing ? 'pointer-events: none; user-select: none;' : ''}${this
              ._attachableViewerState.value.visible &&
            this._attachableViewerState.value.position === 'side'
              ? `width: ${
                  this._drawerWidth > 200 ? this._drawerWidth : 200
                }px; display: flex; flex-grow: 0; flex-shrink: 0;`
              : ''}"
            @click=${(e) => {
              // Prevent propagation such hat only clicks outside of this container bubble up and we
              // can close the attachable-view-container on side-click
              e.stopPropagation();
            }}
          >
            ${this.renderOpenTabs()}
          </div>
        </div>

        <!-- BOTTOM BAR -->
        <div
          class="attachable-view-bar"
          style="${this._attachableViewerState.value.visible ? '' : 'display: none;'}"
          @click=${(e) => {
            // Prevent propagation such hat only clicks outside of this container bubble up and we
            // can close the attachable-view-container on side-click
            e.stopPropagation();
          }}
        >
          ${this.renderEntryTabBar()}
        </div>
      </div>

      <!-- LEFT SIDEBAR -->
      <div class="column left-sidebar">
        <div
          class="column top-left-corner ${this._dashboardState.value.viewType === 'personal'
            ? 'selected'
            : ''}"
        >
          <button class="home-button"
            .selected=${false}
            .tooltipText=${msg('Home')}
            placement="bottom"
            tabindex="0"
            @click=${() => {
              this._weStore.setDashboardState({ viewType: 'personal' });
              this._weStore.setAttachableViewerState({
                position: this._attachableViewerState.value.position,
                visible: false,
              });
            }}
            @keypress=${(e: KeyboardEvent) => {
              if (e.key === 'Enter') {
                this._weStore.setDashboardState({ viewType: 'personal' });
                this._weStore.setAttachableViewerState({
                  position: this._attachableViewerState.value.position,
                  visible: false,
                });
              }
            }}
          >
            <img class="moss-icon" src="moss-icon.svg" />
          </button>
        </div>

        <groups-sidebar
          class="left-group-sidebar"
          .selectedGroupDnaHash=${this._dashboardState.value.viewType === 'group'
            ? this._dashboardState.value.groupHash
            : undefined}
          .indicatedGroupDnaHashes=${this._attachableViewerState.value.visible &&
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
        <div class="row center-content" style="margin-bottom: 5px;">
          <sl-tooltip content="${msg('Create New Attachable')}" placement="right" hoist>
            <button class="moss-button"
              @click=${() => this.openCreatablePanel()}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  this.openCreatablePanel();
                }
              }}>
              <img
                tabindex="0"
                class="moss-button-icon"
                src="magic-wand.svg"
                style="width: 24px; height: 24px;"
              />
            </button>
          </sl-tooltip>
        </div>
        <div class="row center-content" style="margin-bottom: 5px;">
          <sl-tooltip content="Search" placement="right" hoist>
            <button class="moss-button"
              @click=${() => this.openClipboard()}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  this.openClipboard();
                }
              }}>
            <sl-icon
              tabindex="0"
              class="moss-button-icon"
              .src=${wrapPathInSvg(mdiMagnify)}
              style="color: #fff; height: 24px; width: 24px"
            ></sl-icon>
            </button>
          </sl-tooltip>
        </div>
        <div
          @dblclick=${() => this.openZomeCallPanel()}
          style="color: white; text-align: center; margin-bottom: 3px;"
          title=${this.appVersion
            ? `
        Lightningrod Labs We version ${this.appVersion}`
            : ``}
        >
          ${this.appVersion ? `v${this.appVersion}` : ''}
        </div>
      </div>

      <!-- TOP BAR -->
      <div
        class="top-bar row"
        style="flex: 1; position: fixed; left: var(--sidebar-width); top: 0; right: 0;"
      >
        <div class="row invisible-scrollbars" style="overflow-x: auto; padding-right: 40px;">
          ${this._dashboardState.value.viewType === 'group'
            ? html`
                <group-context .groupDnaHash=${this._dashboardState.value.groupHash}>
                  <group-applets-sidebar
                    .selectedAppletHash=${this._dashboardState.value.appletHash}
                    .indicatedAppletHashes=${this._attachableViewerState.value.visible &&
                    this._selectedTab &&
                    this._selectedTab.tab.type === 'hrl'
                      ? this._selectedTab.tab.appletIds
                      : []}
                    @applet-selected=${(e: {
                      detail: { appletHash: AppletHash; groupDnaHash: DnaHash };
                    }) => {
                      this._weStore.setDashboardState({
                        viewType: 'group',
                        groupHash: e.detail.groupDnaHash,
                        appletHash: e.detail.appletHash,
                      });
                      if (this._attachableViewerState.value.position === 'front') {
                        this._weStore.setAttachableViewerState({
                          position: 'front',
                          visible: false,
                        });
                      }
                    }}
                    @refresh-applet=${(e: CustomEvent) => {
                      const allIframes = getAllIframes();
                      const appletIframe = allIframes.find(
                        (iframe) => iframe.id === encodeHashToBase64(e.detail.appletHash),
                      );
                      if (appletIframe) {
                        appletIframe.src += '';
                      }
                    }}
                    style="margin-left: 12px; flex: 1; overflow-x: sroll;"
                  ></group-applets-sidebar>
                </group-context>
              `
            : html``}
        </div>
        <div style="display: flex; flex: 1;"></div>
        <div class="row">
          <sl-tooltip content="Show Attachable Viewer in Front" placement="bottom" hoist>
            <div
              id="tab-bar-button"
              class="entry-tab-bar-button ${this._attachableViewerState.value.visible &&
              this._attachableViewerState.value.position === 'front'
                ? 'btn-selected'
                : ''}"
              tabindex="0"
              @click=${(e) => {
                e.stopPropagation();
                if (
                  this._attachableViewerState.value.visible &&
                  this._attachableViewerState.value.position === 'front'
                ) {
                  this._weStore.setAttachableViewerState({ position: 'front', visible: false });
                  return;
                }
                this._weStore.setAttachableViewerState({ position: 'front', visible: true });
              }}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  e.stopPropagation();
                  if (
                    this._attachableViewerState.value.visible &&
                    this._attachableViewerState.value.position === 'front'
                  ) {
                    this._weStore.setAttachableViewerState({ position: 'front', visible: false });
                    return;
                  }
                  this._weStore.setAttachableViewerState({ position: 'front', visible: true });
                }
              }}
            >
              <div class="column center-content">
                <sl-icon
                  .src=${wrapPathInSvg(mdiViewGalleryOutline)}
                  style="font-size: 34px;"
                ></sl-icon>
                front
              </div>
            </div>
          </sl-tooltip>

          <sl-tooltip content="Show Attachable Viewer to the Side" placement="bottom" hoist>
            <div
              id="tab-bar-button"
              class="entry-tab-bar-button ${this._attachableViewerState.value.visible &&
              this._attachableViewerState.value.position === 'side'
                ? 'btn-selected'
                : ''}"
              tabindex="0"
              @click="${(_e) => {
                if (
                  this._attachableViewerState.value.visible &&
                  this._attachableViewerState.value.position === 'side'
                ) {
                  this._weStore.setAttachableViewerState({ position: 'side', visible: false });
                  return;
                }
                this._weStore.setAttachableViewerState({ position: 'side', visible: true });
              }}"
              @keypress="${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  if (
                    this._attachableViewerState.value.visible &&
                    this._attachableViewerState.value.position === 'side'
                  ) {
                    this._weStore.setAttachableViewerState({ position: 'side', visible: false });
                    return;
                  }
                  this._weStore.setAttachableViewerState({ position: 'side', visible: true });
                }
              }}"
            >
              <div class="column center-content">
                <sl-icon
                  .src=${wrapPathInSvg(mdiViewGalleryOutline)}
                  style="font-size: 34px;"
                ></sl-icon>
                side
              </div>
            </div>
          </sl-tooltip>
        </div>
      </div>
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

        .hidden {
          display: none;
        }

        .top-left-corner {
          align-items: center;
          justify-content: center;
          height: var(--sidebar-width);
        }

        .home-button {
          background-color: transparent;
          border: none;
          width: 50px;
          height: 50px;
          outline: none;
        }

        .home-button:hover {
          cursor: pointer;
        }

        .top-left-corner:hover {
          border-radius: 100% 0 0 100%;
          background: linear-gradient(90deg, #96D96E 0%, #394333 90.91%);
          cursor: pointer;

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

        .drawer-separator {
          width: 2px;
          background: var(--sl-color-tertiary-200);
          cursor: col-resize;
        }

        .side-drawer {
          position: relative;
          max-height: calc(100vh - 124px);
          background: var(--sl-color-tertiary-0);
          border-top: 4px solid var(--sl-color-tertiary-50);
        }

        .attachable-viewer {
          overflow: hidden;
          display: flex;
          flex: 1;
          position: fixed;
          top: 79px;
          left: 79px;
          bottom: 50px;
          right: 0;
          background: var(--sl-color-tertiary-0);
          box-shadow: 0 0 4px 1px var(--sl-color-tertiary-0);
          /* box-shadow: 0 0 4px 1px #51ed18; */
          border-radius: 20px 0 0 0;
          border-top: 1px solid var(--sl-color-secodary-800);
          border-left: 1px solid var(--sl-color-secodary-200);
          /* border-top: 1px solid #51ed18;
          border-left: 1px solid #51ed18; */
        }

        .group-viewer {
          /* display: flex; */
          flex: 1;
          position: fixed;
          top: 74px;
          left: 74px;
          bottom: 0;
          right: 0;
          padding-left: 8px;
          background-color: rgba(57, 67, 50, 1.0);
        }

        #group-view-area {
          overflow: hidden;
          max-height: calc(100vh - 70px);
        }

        .invisible-scrollbars {
          -ms-overflow-style: none; /* IE and Edge */
          scrollbar-width: none; /* Firefox */
        }

        .invisible-scrollbars::-webkit-scrollbar {
          display: none;
        }

        .selected {
          border-radius: 100% 0 0 100%;
          background: linear-gradient(90deg, #597448 0%, #394333 90.91%);
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

        .attachable-view-bar {
          display: flex;
          align-items: center;
          padding-left: 5px;
          height: 50px;
          color: var(--sl-color-secondary-950);
          /* background: #51ed18; */
          /* background: var(--sl-color-secondary-950); */
          background: var(--sl-color-tertiary-100);
          z-index: 1;
        }

        .entry-tab {
          height: 40px;
          width: 200px;
          background: var(--sl-color-tertiary-400);
          color: black;
          /* background: var(--sl-color-primary-400); */
          border-radius: 4px;
          margin-right: 5px;
          padding-left: 4px;
          cursor: default;
          position: relative;
        }

        .entry-tab:hover {
          background: var(--sl-color-tertiary-0);
        }

        .tab-selected {
          background: var(--sl-color-tertiary-0);
          box-shadow: 0 0 3px #808080;
        }

        .entry-tab-bar-button {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: row;
          color: var(--sl-color-tertiary-0);
          background: var(--sl-color-tertiary-800);
          cursor: pointer;
          /* margin: 5px; */
          height: 74px;
          width: 50px;
        }

        .entry-tab-bar-button:hover {
          background: var(--sl-color-tertiary-50);
          color: var(--sl-color-tertiary-950);
          /* margin: 0; */
          /* border-radius: 5px 0 0 5px; */
          /* height: 50px; */
        }

        .entry-tab-bar-button:focus {
          background: var(--sl-color-tertiary-50);
          color: var(--sl-color-tertiary-950);
        }

        .btn-selected {
          background: var(--sl-color-tertiary-50);
          color: var(--sl-color-tertiary-950);
          /* margin: 0;
          border-radius: 5px 0 0 5px;
          height: 50px; */
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
          position: fixed;
          left: 0;
          top: 0;
          bottom: 0;
          background: linear-gradient(270deg, #101C09 0%, #293C2C 100%);
        }

        .left-group-sidebar {
          width: var(--sidebar-width);
          display: flex;
          overflow-y: auto;
          overflow-x: hidden;
          -ms-overflow-style: none; /* IE and Edge */
          scrollbar-width: none; /* Firefox */
        }

        .left-group-sidebar::-webkit-scrollbar {
          display: none;
        }

        .top-bar {
          background: #394333;
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
          transform: translateX(102%);
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
          transform: translateX(102%);
        }

        .moss-button-icon {
          font-size: 66px;
          color: #fff;
          cursor: pointer;
        }

        .moss-button-icon:hover {
          color: var(--sl-color-primary-50);
        }

        .moss-button-icon:focus {
          color: var(--sl-color-primary-50);
        }

        .moss-button {
          width: 40px;
          height: 40px;
          outline: none;
          border: none;
          color: #fff;
          background: linear-gradient(270deg, #394333 0%, #526C44 100%);
          box-shadow: 0px 4px 4px rgba(0, 0, 0, 0.25);
          border-radius: 5px;        
        }

        .moss-button:hover {
          background: linear-gradient(270deg, #495542 0%, #67924F 100%);
          cursor: pointer;
        }
      `,
    ];
  }
}

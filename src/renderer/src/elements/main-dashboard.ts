import { consume, provide } from '@lit/context';
import { classMap } from 'lit/directives/class-map.js';
import { state, customElement, query, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import {
  encodeHashToBase64,
  DnaHash,
  decodeHashFromBase64,
  DnaHashB64,
  ActionHashB64,
} from '@holochain/client';
import { LitElement, html, css, TemplateResult } from 'lit';
import {
  StoreSubscriber,
  asyncDeriveStore,
  joinAsyncMap,
  toPromise,
} from '@holochain-open-dev/stores';
import { Hrl, mapValues } from '@holochain-open-dev/utils';
import { notify, notifyError, wrapPathInSvg } from '@holochain-open-dev/elements';
import { msg } from '@lit/localize';
import { mdiAccountLockOpen, mdiAccountMultiplePlus, mdiMagnify } from '@mdi/js';
import {
  AppletHash,
  AppletId,
  WAL,
  OpenWalMode,
  WeaveLocation,
  weaveUrlToLocation,
  weaveUrlFromWal,
} from '@lightningrodlabs/we-applet';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@lightningrodlabs/we-elements/dist/elements/weave-client-context.js';
import '@lightningrodlabs/we-elements/dist/elements/wal-to-pocket.js';

import '../layout/views/welcome-view.js';
import '../groups/elements/entry-title.js';
import './groups-sidebar.js';
import './group-applets-sidebar.js';
import './personal-view-sidebar.js';
import './join-group-dialog.js';
import '../layout/views/applet-main.js';
import '../layout/views/cross-applet-main.js';
import '../layout/views/tool-library.js';
import '../layout/views/publishing-view.js';
import '../layout/views/asset-view.js';
import '../groups/elements/group-container.js';
import './debugging-panel.js';

import { weStyles } from '../shared-styles.js';
import { mossStoreContext } from '../context.js';
import { MossStore } from '../moss-store.js';
import { JoinGroupDialog } from './join-group-dialog.js';
import { CreateGroupDialog } from './create-group-dialog.js';

import './pocket.js';
import './creatable-panel.js';
import { MossPocket } from './pocket.js';
import { CreatablePanel } from './creatable-panel.js';
import { appletMessageHandler, handleAppletIframeMessage } from '../applets/applet-host.js';
import { openViewsContext } from '../layout/context.js';
import { AppOpenViews } from '../layout/types.js';
import {
  decodeContext,
  getAllIframes,
  invitePropsToPartialModifiers,
  logMossZomeCall,
  progenitorFromProperties,
} from '../utils.js';
import { dialogMessagebox } from '../electron-api.js';
import { UpdateFeedMessage } from '../types.js';

type OpenTab =
  | {
      type: 'wal';
      wal: WAL;
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

export type PersonalViewState =
  | {
      type: 'moss';
      name: string;
    }
  | {
      type: 'tool';
      originalToolActionHash: ActionHashB64;
    };

export type DashboardState =
  | {
      viewType: 'personal';
      viewState: PersonalViewState;
    }
  | { viewType: 'group'; groupHash: DnaHash; appletHash?: AppletHash };

export type AssetViewerState = {
  position: 'side';
  visible: boolean;
};

@customElement('main-dashboard')
export class MainDashboard extends LitElement {
  @consume({ context: mossStoreContext })
  @state()
  _mossStore!: MossStore;

  @query('#join-group-dialog')
  joinGroupDialog!: JoinGroupDialog;

  @query('#create-group-dialog')
  createGroupDialog!: CreateGroupDialog;

  @query('#add-group-dialog')
  addGroupDialog!: SlDialog;

  @query('#pocket')
  _pocket!: MossPocket;

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
  _openApplets: AppletHash[] = [];

  @state()
  _selectedTab: TabInfo | undefined;

  @state()
  _updateFeed: Array<UpdateFeedMessage> = [];

  @state()
  hoverPersonalView = false;

  @state()
  hoverMossButton = false;

  @state()
  hoverTopBar = false;

  _dashboardState = new StoreSubscriber(
    this,
    () => this._mossStore.dashboardState(),
    () => [this._mossStore],
  );

  _assetViewerState = new StoreSubscriber(
    this,
    () => this._mossStore.assetViewerState(),
    () => [this._mossStore],
  );

  _allGroupHashes = new StoreSubscriber(
    this,
    () => this._mossStore.groupsDnaHashes,
    () => [this._mossStore],
  );

  _runningApplets = new StoreSubscriber(
    this,
    () => this._mossStore.runningApplets,
    () => [this._mossStore],
  );

  _runningAppletClasses = new StoreSubscriber(
    this,
    () => this._mossStore.runningAppletClasses,
    () => [this, this._mossStore],
  );

  // _unlisten: UnlistenFn | undefined;

  @provide({ context: openViewsContext })
  @property()
  openViews: AppOpenViews = {
    openAppletMain: async (appletHash) => {
      const groupsForApplet = await toPromise(this._mossStore.groupsForApplet.get(appletHash));
      const groupDnaHashes = Array.from(groupsForApplet.keys());
      if (groupDnaHashes.length === 0) {
        notifyError('Applet not found in any of your groups.');
        throw new Error('Applet not found in any of your groups.');
      }
      if (
        !this._openApplets
          .map((appletHash) => appletHash.toString())
          .includes(appletHash.toString())
      ) {
        this._openApplets = [...this._openApplets, appletHash];
      }
      // pick an arbitrary group this applet is installed in
      const groupDnaHash = groupDnaHashes[0];
      this._mossStore.setDashboardState({
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
    openWal: async (wal: WAL, mode?: OpenWalMode) => {
      const tabId = weaveUrlFromWal(wal);
      try {
        const [groupContextHashesB64, appletContextIds] = await this.getRelatedGroupsAndApplets(
          wal.hrl,
        );
        const tabInfo: TabInfo = {
          id: tabId,
          tab: {
            type: 'wal',
            wal,
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
    userSelectWal: async () => {
      this._pocket.show('select');

      return new Promise((resolve) => {
        const listener = (e) => {
          switch (e.type) {
            case 'cancel-select-wal':
              this.removeEventListener('cancel-select-wal', listener);
              return resolve(undefined);
            case 'wal-selected':
              const wal: WAL = e.detail.wal;
              this.removeEventListener('wal-selected', listener);
              this._pocket.hide();
              return resolve(wal);
          }
        };
        this.addEventListener('wal-selected', listener);
        this.addEventListener('cancel-select-wal', listener);
      });
    },
    toggleClipboard: () => this.toggleClipboard(),
  };

  openZomeCallPanel() {
    const tabId = 'debugging-panel';
    const tabInfo: TabInfo = {
      id: tabId,
      tab: {
        type: 'html',
        title: 'Debugging Panel',
        template: html` <debugging-panel></debugging-panel> `,
      },
    };
    this._mossStore.setAssetViewerState({ position: 'side', visible: true });
    this.openTab(tabInfo);
  }

  async getRelatedGroupsAndApplets(hrl: Hrl): Promise<[DnaHashB64[], AppletId[]]> {
    const location = await toPromise(this._mossStore.hrlLocations.get(hrl[0]).get(hrl[1]));
    if (location) {
      const appletContextHashes = [encodeHashToBase64(location.dnaLocation.appletHash)];
      const groupsForApplet = await toPromise(
        this._mossStore.groupsForApplet.get(location.dnaLocation.appletHash),
      );
      const groupDnaHashes = Array.from(groupsForApplet.keys());
      const groupContextHashesB64 = groupDnaHashes.map((hash) => encodeHashToBase64(hash));
      return [groupContextHashesB64, appletContextHashes];
    } else {
      return [[], []];
    }
  }

  async openTab(tabInfo: TabInfo, mode?: OpenWalMode) {
    if (mode === 'window') throw Error("Mode 'window' cannot be opened in a tab");
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
      tabInfo.tab.type === 'wal' &&
      tabInfo.tab.groupHashesB64.length > 0
    ) {
      const groupDnaHash = decodeHashFromBase64(tabInfo.tab.groupHashesB64[0]);
      this.openGroup(groupDnaHash);
      this._dashboardState.value = {
        viewType: 'group',
        groupHash: groupDnaHash,
      };
    }
    this._mossStore.setAssetViewerState({
      position: 'side',
      visible: true,
    });
    this._selectedTab = tabInfo;
  }

  async handleOpenInvite(inviteProps: string) {
    const groups = await toPromise(
      asyncDeriveStore(this._mossStore.groupStores, (groups) =>
        joinAsyncMap(mapValues(groups, (groupStore) => groupStore.modifiers)),
      ),
    );

    const modifiers = invitePropsToPartialModifiers(inviteProps);

    const alreadyJoinedGroup = Array.from(groups.entries()).find(
      ([_, groupModifiers]) =>
        groupModifiers.network_seed === modifiers.networkSeed &&
        progenitorFromProperties(groupModifiers.properties) === modifiers.progenitor,
    );

    if (alreadyJoinedGroup) {
      notify(msg("You're already part of this group."));
      this.openGroup(alreadyJoinedGroup[0]);
    } else {
      this.joinGroupDialog.open(modifiers);
    }
  }

  async handleOpenGroup(networkSeed: string) {
    const groups = await toPromise(
      asyncDeriveStore(this._mossStore.groupStores, (groups) =>
        joinAsyncMap(mapValues(groups, (groupStore) => groupStore.modifiers)),
      ),
    );

    const alreadyJoinedGroup = Array.from(groups.entries()).find(
      ([_, groupModifiers]) => groupModifiers.network_seed === networkSeed,
    );

    if (alreadyJoinedGroup) {
      this.openGroup(alreadyJoinedGroup[0]);
    } else {
      notifyError('The link is for a group you are not part of.');
    }
  }

  async handleOpenWal(wal: WAL) {
    const tabId = weaveUrlFromWal(wal);
    const alreadyOpen = Object.values(this._openTabs).find((tabInfo) => tabInfo.id === tabId);
    if (alreadyOpen) {
      this.openTab(alreadyOpen);
      return;
    }
    try {
      const [groupContextHashesB64, appletContextIds] = await this.getRelatedGroupsAndApplets(
        wal.hrl,
      );
      const tabInfo: TabInfo = {
        id: tabId,
        tab: {
          type: 'wal',
          wal,
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
          return this.handleOpenWal(weaveLocation.wal);
      }
    }
  }

  async handleOpenAppletMain(appletHash: AppletHash) {
    this.openViews.openAppletMain(appletHash);
  }

  async firstUpdated() {
    window.addEventListener('message', appletMessageHandler(this._mossStore, this.openViews));
    window.electronAPI.onAppletToParentMessage(async (_e, payload) => {
      console.log('Got cross window applet to parent message: ', payload);
      if (!payload.message.appletHash)
        throw new Error('appletHash not defined in AppletToParentMessage');
      const response = await handleAppletIframeMessage(
        this._mossStore,
        this.openViews,
        encodeHashToBase64(payload.message.appletHash),
        payload.message.request,
      );
      await window.electronAPI.appletMessageToParentResponse(response, payload.id);
    });
    window.electronAPI.onSwitchToApplet((_, appletId) => {
      if (appletId) {
        this.openViews.openAppletMain(decodeHashFromBase64(appletId));
      }
    });

    window.electronAPI.onZomeCallSigned((_, { cellIdB64, fnName, zomeName }) => {
      logMossZomeCall(cellIdB64, fnName, zomeName);
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
          await this.handleOpenWal({
            hrl: [decodeHashFromBase64(split2[1]), decodeHashFromBase64(contextSplit[0])],
            context: contextSplit[1] ? decodeContext(contextSplit[1]) : undefined,
          });
        } else if (split2[0] === 'invite') {
          await this.handleOpenInvite(split2[1]);
        } else if (split2[0] === 'group') {
          await this.handleOpenGroup(split2[1]);
        } else if (split2[0] === 'applet') {
          await this.handleOpenAppletMain(decodeHashFromBase64(split2[1]));
        }
      } catch (e) {
        console.error(e);
        notifyError(msg('Error opening the link.'));
      }
    });

    // add eventlistener for pocket
    window.addEventListener('keydown', (zEvent) => {
      if (zEvent.altKey && zEvent.key === 's') {
        // case sensitive
        switch (this.showClipboard) {
          case false:
            this.showClipboard = true;
            this._pocket.show('open');
            this._pocket.focus();
            break;
          case true:
            this._pocket.hide();
            break;
        }
      }
    });

    // setInterval(() => {
    //   const allIframes = getAllIframes();
    //   console.log('CURRENT IFRAME COUNT: ', allIframes.length);
    // }, 10000);

    this.appVersion = this._mossStore.version;

    // Fetch Moss update feed
    try {
      // TODO change URL to point to main branch before merging
      const response = await fetch(
        'https://raw.githubusercontent.com/lightningrodlabs/moss/main/news.json',
      );
      const updateFeed = await response.json();
      if (updateFeed['0.13.x']) {
        this._updateFeed = updateFeed['0.13.x'];
      }
    } catch (e) {
      // Fetch Moss update feed
      try {
        // TODO change URL to point to main branch before merging
        const response = await fetch(
          'https://raw.githubusercontent.com/lightningrodlabs/we/main/news.json',
        );
        const updateFeed = await response.json();
        if (updateFeed['0.13.x']) {
          this._updateFeed = updateFeed['0.13.x'];
        }
      } catch (e) {
        console.warn('Failed to fetch update feed: ', e);
      }
    }
  }

  openClipboard() {
    this.showClipboard = true;
    this._pocket.show('open');
    this._pocket.focus();
  }

  openCreatablePanel() {
    this.showCreatablePanel = true;
    this._creatablePanel.show();
    this._creatablePanel.focus();
  }

  closeClipboard() {
    this.showClipboard = false;
    this._pocket.hide();
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

  displayMossView(name: string) {
    return (
      this._dashboardState.value.viewType === 'personal' &&
      this._dashboardState.value.viewState.type === 'moss' &&
      this._dashboardState.value.viewState.name === name
    );
  }

  displayCrossGroupTool(originalToolActionHash: ActionHashB64) {
    return (
      this._dashboardState.value.viewType === 'personal' &&
      this._dashboardState.value.viewState.type === 'tool' &&
      this._dashboardState.value.viewState.originalToolActionHash === originalToolActionHash
    );
  }

  displayApplet(appletHash: AppletHash) {
    return (
      this._dashboardState.value.viewType === 'group' &&
      this._dashboardState.value.appletHash &&
      this._dashboardState.value.appletHash.toString() === appletHash.toString()
    );
  }

  displayGroupContainer(groupHash: DnaHash) {
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
      this._openGroups = [...this._openGroups, groupDnaHash];
    }
    this._mossStore.setDashboardState({
      viewType: 'group',
      groupHash: groupDnaHash,
    });
    // this.dynamicLayout.openTab({
    //   id: `group-home-${encodeHashToBase64(groupDnaHash)}`,
    //   type: "component",
    //   componentType: "group-home",
    //   componentState: {
    //     groupDnaHash: encodeHashToBase64(groupDnaHash),
    //   },
    // });
  }

  async activateAppletsForGroup(groupDnaHash) {
    console.log('Activating applets for group: ', encodeHashToBase64(groupDnaHash));

    if (
      !this._openGroups
        .map((hash) => encodeHashToBase64(hash))
        .includes(encodeHashToBase64(groupDnaHash))
    ) {
      this._openGroups = [...this._openGroups, groupDnaHash];
    }

    const groupStore = await this._mossStore.groupStore(groupDnaHash);
    if (groupStore) {
      const runningGroupApplets = await toPromise(groupStore.allMyRunningApplets);
      const openApplets = this._openApplets;
      const openAppletsStringified = openApplets.map((appletHash) => appletHash.toString());
      runningGroupApplets.forEach((appletHash) => {
        if (!openAppletsStringified.includes(appletHash.toString())) {
          openApplets.push(appletHash);
        }
      });
    } else {
      console.warn('Failed to activate applets for group since group store is not (yet) defined.');
    }
    this.requestUpdate();
  }

  renderAppletMainViews() {
    switch (this._runningApplets.value.status) {
      case 'pending':
        return html`Loading running applets...`;
      case 'error':
        return html`Failed to get running applets: ${this._runningApplets.value.error}`;
      case 'complete':
        return repeat(
          this._runningApplets.value.value,
          (appletHash) => encodeHashToBase64(appletHash),
          (appletHash) => html`
            <applet-main
              .appletHash=${appletHash}
              style="flex: 1; ${this.displayApplet(appletHash) ? '' : 'display: none'}"
            ></applet-main>
          `,
        );
    }
  }

  renderToolCrossGroupViews() {
    switch (this._runningAppletClasses.value.status) {
      case 'pending':
        return html`Loading running tool classes...`;
      case 'error':
        return html`Failed to get running tool classes: ${this._runningAppletClasses.value.error}`;
      case 'complete':
        return repeat(
          Object.keys(this._runningAppletClasses.value.value),
          (originalToolActionHash) => originalToolActionHash,
          (originalToolActionHash) => html`
            <cross-applet-main
              .toolBundleHash=${decodeHashFromBase64(originalToolActionHash)}
              hostColor="#224b21"
              style="flex: 1; ${this.displayCrossGroupTool(originalToolActionHash)
                ? ''
                : 'display: none;'}
                ${this._drawerResizing ? 'pointer-events: none; user-select: none;' : ''}
                overflow-x: auto;"
            ></cross-applet-main>
          `,
        );
      default:
        return html`Invalid async status`;
    }
  }

  renderMossViews() {
    return html`
      <welcome-view
        id="welcome-view"
        @click=${(e) => e.stopPropagation()}
        .updateFeed=${this._updateFeed}
        style="${this.displayMossView('welcome')
          ? 'display: flex; flex: 1;'
          : 'display: none;'}${this._drawerResizing
          ? 'pointer-events: none; user-select: none;'
          : ''} overflow-x: hidden;"
        @request-create-group=${() => this.createGroupDialog.open()}
        @request-join-group=${(_e) => this.joinGroupDialog.open()}
        @applet-selected=${(e: CustomEvent) => {
          this.openViews.openAppletMain(e.detail.appletHash);
        }}
      ></welcome-view>

      <tool-library
        style="${this.displayMossView('tool-library')
          ? 'display: flex; flex: 1;'
          : 'display: none;'}${this._drawerResizing
          ? 'pointer-events: none; user-select: none;'
          : ''} position: relative; overflow-x: auto;"
        @applet-installed=${(e: {
          detail: {
            appletEntryHash: AppletHash;
            groupDnaHash: DnaHash;
          };
        }) => {
          if (
            !this._openApplets
              .map((appletHash) => appletHash.toString())
              .includes(e.detail.appletEntryHash.toString())
          ) {
            this._openApplets = [...this._openApplets, e.detail.appletEntryHash];
          }
          this._mossStore.setDashboardState({
            viewType: 'group',
            groupHash: e.detail.groupDnaHash,
            appletHash: e.detail.appletEntryHash,
          });
        }}
      ></tool-library>

      <publishing-view
        style="${this.displayMossView('publisher-panel')
          ? 'display: flex; flex: 1;'
          : 'display: none;'}${this._drawerResizing
          ? 'pointer-events: none; user-select: none;'
          : ''} overflow-x: auto;"
      ></publishing-view>
    `;
  }

  renderDashboard() {
    return html`
      ${this.renderAppletMainViews()}
      ${repeat(
        this._openGroups,
        (group) => encodeHashToBase64(group),
        (groupHash) => html`
          <group-context .groupDnaHash=${groupHash}>
            <group-container
              .groupDnaHash=${groupHash}
              style="flex: 1; position: relative; ${this.displayGroupContainer(groupHash)
                ? ''
                : 'display: none'}"
              @group-left=${() => {
                this._mossStore.setDashboardState({
                  viewType: 'personal',
                  viewState: { type: 'moss', name: 'welcome' },
                });
              }}
              @disable-group=${async (e: CustomEvent) => {
                const confirmation = await dialogMessagebox({
                  message:
                    'WARNING: Disabling a group will refresh Moss. Save any unsaved content in Tools of other groups before you proceed.',
                  type: 'warning',
                  buttons: ['Cancel', 'Continue'],
                });
                if (confirmation.response === 0) return;
                try {
                  await this._mossStore.disableGroup(e.detail);
                  window.location.reload();
                } catch (e) {
                  console.error(`Failed to disable Group: ${e}`);
                  notifyError(msg('Failed to disable Group.'));
                }
              }}
              @applet-selected=${(e: CustomEvent) => {
                this.openViews.openAppletMain(e.detail.appletHash);
              }}
              @applet-installed=${(e: {
                detail: {
                  appletEntryHash: AppletHash;
                  groupDnaHash: DnaHash;
                };
              }) => {
                if (
                  !this._openApplets
                    .map((appletHash) => appletHash.toString())
                    .includes(e.detail.appletEntryHash.toString())
                ) {
                  this._openApplets = [...this._openApplets, e.detail.appletEntryHash];
                }
                this._mossStore.setDashboardState({
                  viewType: 'group',
                  groupHash: e.detail.groupDnaHash,
                  appletHash: e.detail.appletEntryHash,
                });
              }}
              @applets-disabled=${(e: { detail: Array<AppletHash> }) => {
                // Make sure applet iframes get removed in the background
                const disabledApplets = e.detail.map((appletHash) => appletHash.toString());
                this._openApplets = this._openApplets.filter(
                  (appletHash) => !disabledApplets.includes(appletHash.toString()),
                );
              }}
              @custom-view-selected=${(_e) => {
                throw new Error('Displaying custom views is currently not implemented.');
              }}
              @custom-view-created=${(_e) => {
                throw new Error('Displaying custom views is currently not implemented.');
              }}
            ></group-container>
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
          Asset Viewer
        </div>
        <div style="font-size: 20px; max-width: 800px; text-align: center;">
          This is where assets are displayed. Opening an asset from one of your Tools will create a
          new tab here.
        </div>
      </div>`;
    }
    return repeat(
      allOpenTabs,
      (tab) => tab.id,
      (tab) => {
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
      },
    );
  }

  renderTabContent(info: TabInfo) {
    switch (info.tab.type) {
      case 'wal':
        return html`<asset-view
          @jump-to-applet=${(e) => {
            this.openViews.openAppletMain(e.detail);
          }}
          .wal=${info.tab.wal}
          style="display: flex; flex: 1;"
        ></asset-view>`;
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
            this._mossStore.setAssetViewerState({
              position: this._assetViewerState.value.position,
              visible: true,
            });
          } else {
            this._mossStore.setAssetViewerState({
              position: this._assetViewerState.value.position,
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
              this._mossStore.setAssetViewerState({
                position: this._assetViewerState.value.position,
                visible: true,
              });
            } else {
              this._mossStore.setAssetViewerState({
                position: this._assetViewerState.value.position,
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
      return html`<span style="margin-left: 10px; font-size: 20px;">No open assets...</span>`;
    }
    return openTabs.map((tabInfo) => {
      switch (tabInfo.tab.type) {
        case 'wal':
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
                this._mossStore.setAssetViewerState({
                  position: this._assetViewerState.value.position,
                  visible: true,
                });
              }}
              @keypress=${async (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  e.stopPropagation();
                  this._selectedTab = tabInfo;
                  this._mossStore.setAssetViewerState({
                    position: this._assetViewerState.value.position,
                    visible: true,
                  });
                }
              }}
            >
              ${this.renderCloseTab(tabInfo.id)}
              <entry-title .wal=${tabInfo.tab.wal}></entry-title>
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

  renderAddGroupDialog() {
    return html`
      <sl-dialog id="add-group-dialog" label="${msg('Add Group')}">
        <div class="row center-content" style="margin-bottom: 30px;">
          <sl-button
            style="margin: 0 5px;"
            variant="primary"
            @click=${(_e) => {
              this.joinGroupDialog.open();
              this.addGroupDialog.hide();
            }}
          >
            <div class="row center-content" style="margin: 8px;">
              <sl-icon
                .src=${wrapPathInSvg(mdiAccountLockOpen)}
                style="height: 40px; width: 40px; margin-right: 10px;"
              ></sl-icon>
              <span>${'Join Group'}</span>
            </div>
          </sl-button>
          <sl-button
            style="margin: 0 5px;"
            variant="primary"
            @click=${() => {
              this.createGroupDialog.open();
              this.addGroupDialog.hide();
            }}
          >
            <div class="row center-content" style="margin: 8px;">
              <sl-icon
                .src=${wrapPathInSvg(mdiAccountMultiplePlus)}
                style="height: 40px; width: 40px; margin-right: 10px;"
              ></sl-icon>
              <span>${msg('Create Group')}</span>
            </div>
          </sl-button>
        </div>
      </sl-dialog>
    `;
  }

  render() {
    return html`
      <moss-pocket
        id="pocket"
        @click=${(e) => e.stopPropagation()}
        @open-wal=${async (e) => await this.handleOpenWal(e.detail.wal)}
        @open-wurl=${async (e) => await this.handleOpenWurl(e.detail.wurl)}
        @open-creatable-panel=${() => this._creatablePanel.show()}
        @wal-selected=${(e) => {
          this.dispatchEvent(
            new CustomEvent('wal-selected', {
              detail: e.detail,
              bubbles: false,
              composed: false,
            }),
          );
        }}
        @sl-hide=${(_e) => {
          this.dispatchEvent(
            new CustomEvent('cancel-select-wal', {
              bubbles: false,
              composed: false,
            }),
          );
          this.showClipboard = false;
        }}
      ></moss-pocket>
      <creatable-panel
        id="creatable-panel"
        @click=${(e) => e.stopPropagation()}
        @open-wal=${async (e) => await this.handleOpenWal(e.detail.wal)}
        @wal-selected=${(e) => {
          this.dispatchEvent(
            new CustomEvent('wal-selected', {
              detail: e.detail,
              bubbles: false,
              composed: false,
            }),
          );
        }}
      ></creatable-panel>

      ${this.renderAddGroupDialog()}

      <join-group-dialog
        id="join-group-dialog"
        @group-joined=${(e) => this.openGroup(e.detail.groupDnaHash)}
      ></join-group-dialog>

      <create-group-dialog
        id="create-group-dialog"
        @group-created=${(e: CustomEvent) => {
          this.openGroup(e.detail.groupDnaHash);
        }}
      ></create-group-dialog>

      <div
        class="group-viewer invisible-scrollbars column ${this._dashboardState.value.viewType ===
        'group'
          ? ''
          : 'personal-view'}"
      >
        <div
          class="row"
          style="flex: 1; ${this._assetViewerState.value.visible
            ? 'max-height: calc(100vh - 124px);'
            : ''}"
        >
          <!-- PERSONAL VIEW -->
          ${this.renderToolCrossGroupViews()} ${this.renderMossViews()}

          <!-- GROUP VIEW -->
          <div
            id="group-view-area"
            style="${this._dashboardState.value.viewType === 'group'
              ? 'display: flex; flex: 1;'
              : 'display: none;'}${this._drawerResizing
              ? 'pointer-events: none; user-select: none;'
              : ''} overflow-x: auto;"
          >
            ${this.renderDashboard()}
          </div>
          <div
            class="drawer-separator"
            style="${this._assetViewerState.value.visible ? '' : 'display: none;'}"
            @mousedown=${(e) => {
              console.log('Got mousedown event: ', e);
              this.resizeMouseDownHandler(e);
            }}
          ></div>

          <div
            id="asset-viewer"
            class="${classMap({
              'side-drawer': this._assetViewerState.value.position === 'side',
              hidden:
                !this._assetViewerState.value.visible &&
                this._assetViewerState.value.position === 'side',
            })}"
            style="${this._drawerResizing ? 'pointer-events: none; user-select: none;' : ''}${this
              ._assetViewerState.value.visible && this._assetViewerState.value.position === 'side'
              ? `width: ${
                  this._drawerWidth > 200 ? this._drawerWidth : 200
                }px; display: flex; flex-grow: 0; flex-shrink: 0;`
              : ''}"
            @click=${(e) => {
              // Prevent propagation such hat only clicks outside of this container bubble up and we
              // can close the asset-view-container on side-click
              e.stopPropagation();
            }}
          >
            ${this.renderOpenTabs()}
          </div>
        </div>

        <!-- BOTTOM BAR -->
        <div
          class="asset-view-bar"
          style="${this._assetViewerState.value.visible ? '' : 'display: none;'}"
          @click=${(e) => {
            // Prevent propagation such hat only clicks outside of this container bubble up and we
            // can close the asset-view-container on side-click
            e.stopPropagation();
          }}
        >
          ${this.renderEntryTabBar()}
        </div>
      </div>

      <!-- LEFT SIDEBAR -->
      <div class="column left-sidebar">
        <div
          class="column top-left-corner ${this._dashboardState.value.viewType === 'personal' ||
          this.hoverPersonalView
            ? 'selected'
            : ''}"
          @mouseenter=${() => {
            this.hoverMossButton = true;
            this.hoverPersonalView = true;
          }}
          @mouseleave=${() => {
            this.hoverMossButton = false;
            setTimeout(() => {
              if (!this.hoverTopBar) {
                this.hoverPersonalView = false;
              }
            }, 50);
          }}
        >
          <button
            class="home-button"
            .selected=${false}
            .tooltipText=${msg('Home')}
            placement="bottom"
            tabindex="0"
            @click=${() => {
              this._mossStore.setDashboardState({
                viewType: 'personal',
                viewState: { type: 'moss', name: 'welcome' },
              });
              this._mossStore.setAssetViewerState({
                position: this._assetViewerState.value.position,
                visible: false,
              });
            }}
            @keypress=${(e: KeyboardEvent) => {
              if (e.key === 'Enter') {
                this._mossStore.setDashboardState({
                  viewType: 'personal',
                  viewState: { type: 'moss', name: 'welcome' },
                });
                this._mossStore.setAssetViewerState({
                  position: this._assetViewerState.value.position,
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
          .indicatedGroupDnaHashes=${this._assetViewerState.value.visible &&
          this._selectedTab &&
          this._selectedTab.tab.type === 'wal'
            ? this._selectedTab.tab.groupHashesB64
            : []}
          @group-selected=${(e: CustomEvent) => {
            this.openGroup(e.detail.groupDnaHash);
          }}
          @request-add-group=${() =>
            (this.shadowRoot?.getElementById('add-group-dialog') as SlDialog).show()}
          @agents-online=${async (e: CustomEvent) => {
            /// Only start applet iframes for groups where agents are actually online
            await this.activateAppletsForGroup(e.detail);
          }}
        ></groups-sidebar>

        <span style="display: flex; flex: 1;"></span>

        <!-- TAB BAR BUTTON -->
        <div class="row center-content" style="margin-bottom: 5px; position: relative;">
          <sl-tooltip content="${msg('Create New Asset')}" placement="right" hoist>
            <button
              tabindex="0"
              class="moss-button"
              @click=${() => this.openCreatablePanel()}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  this.openCreatablePanel();
                }
              }}
            >
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
            <button
              class="moss-button"
              @click=${() => this.openClipboard()}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  this.openClipboard();
                }
              }}
            >
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

      ${this.hoverPersonalView && this._dashboardState.value.viewType === 'group'
        ? html`<div class="personal-view-indicator">${msg('switch to personal view')}</div>`
        : html``}

      <!-- TOP BAR -->
      <div
        class="top-bar row ${this._dashboardState.value.viewType === 'group' &&
        !this.hoverPersonalView
          ? ''
          : 'personal-top-bar'}"
        style="flex: 1; position: fixed; left: var(--sidebar-width); top: 0; right: 0;"
        @mouseenter=${() => {
          this.hoverTopBar = true;
        }}
        @mouseleave=${() => {
          this.hoverTopBar = false;
          setTimeout(() => {
            if (!this.hoverMossButton) {
              this.hoverPersonalView = false;
            }
          }, 50);
        }}
      >
        <div
          id="top-bar-scroller"
          class="row invisible-scrollbars"
          style="overflow-x: auto; padding-right: 40px;"
          @wheel=${(e) => {
            const el = this.shadowRoot!.getElementById('top-bar-scroller');
            if (el)
              el.scrollBy({
                left: e.deltaY < 0 ? -30 : 30,
              });
          }}
        >
          ${this._dashboardState.value.viewType === 'group'
            ? html`
                <group-context .groupDnaHash=${this._dashboardState.value.groupHash}>
                  <group-applets-sidebar
                    id="group-applets-sidebar"
                    style="margin-left: 12px; flex: 1; overflow-x: sroll; ${this.hoverPersonalView
                      ? 'display: none'
                      : ''}"
                    .selectedAppletHash=${this._dashboardState.value.appletHash}
                    .indicatedAppletHashes=${this._assetViewerState.value.visible &&
                    this._selectedTab &&
                    this._selectedTab.tab.type === 'wal'
                      ? this._selectedTab.tab.appletIds
                      : []}
                    @group-home-selected=${() => {
                      this._mossStore.setDashboardState({
                        viewType: 'group',
                        groupHash: (this._dashboardState.value as any).groupHash,
                      });
                    }}
                    @applet-selected=${(e: {
                      detail: { appletHash: AppletHash; groupDnaHash: DnaHash };
                    }) => {
                      if (
                        !this._openApplets
                          .map((appletHash) => appletHash.toString())
                          .includes(e.detail.appletHash.toString())
                      ) {
                        this._openApplets = [...this._openApplets, e.detail.appletHash];
                      }
                      this._mossStore.setDashboardState({
                        viewType: 'group',
                        groupHash: e.detail.groupDnaHash,
                        appletHash: e.detail.appletHash,
                      });
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
                  ></group-applets-sidebar>
                </group-context>
              `
            : html``}
          <personal-view-sidebar
            style="margin-left: 12px; flex: 1; overflow-x: sroll; padding-left: 4px; ${this
              ._dashboardState.value.viewType === 'personal' || this.hoverPersonalView
              ? ''
              : 'display: none'}"
            .selectedView=${this._dashboardState.value.viewType === 'personal'
              ? this._dashboardState.value.viewState
              : undefined}
            @personal-view-selected=${(e) => {
              console.log('@tool-selected: ', e);
              this._mossStore.setDashboardState({
                viewType: 'personal',
                viewState: e.detail,
              });
            }}
          ></personal-view-sidebar>
        </div>
        <div style="display: flex; flex: 1;"></div>
        <div class="row">
          <sl-tooltip
            content="${this._assetViewerState.value.visible
              ? 'Hide Asset Viewer'
              : 'Show Asset Viewer'}"
            placement="bottom"
            hoist
          >
            <div
              id="tab-bar-button"
              class="entry-tab-bar-button ${this._assetViewerState.value.visible &&
              this._assetViewerState.value.position === 'side'
                ? 'btn-selected'
                : ''}"
              tabindex="0"
              @click="${(_e) => {
                if (
                  this._assetViewerState.value.visible &&
                  this._assetViewerState.value.position === 'side'
                ) {
                  this._mossStore.setAssetViewerState({ position: 'side', visible: false });
                  return;
                }
                this._mossStore.setAssetViewerState({ position: 'side', visible: true });
              }}"
              @keypress="${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  if (
                    this._assetViewerState.value.visible &&
                    this._assetViewerState.value.position === 'side'
                  ) {
                    this._mossStore.setAssetViewerState({ position: 'side', visible: false });
                    return;
                  }
                  this._mossStore.setAssetViewerState({ position: 'side', visible: true });
                }
              }}"
            >
              <div class="column center-content">
                <img src="sidebar.svg" style="height: 34px; fill-color: red;" />
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

        sl-dialog {
          --sl-panel-background-color: var(--sl-color-primary-0);
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
          background: linear-gradient(0deg, #203923 0%, #527a22 100%);
          border-radius: 15px;
          border: none;
          width: 58px;
          height: 58px;
          outline: none;
        }

        .home-button:hover {
          cursor: pointer;
        }

        .top-left-corner:hover {
          border-radius: 20px 0 0 20px;
          /* background: linear-gradient(90deg, #cedd58 0%, #224b21 90.91%); */
          /* background: linear-gradient(90deg, #012f00 0%, #224b21 90.91%); */
          background: linear-gradient(90deg, #012f00 0%, #689d19 90.91%);
          cursor: pointer;
        }

        .selected {
          border-radius: 20px 0 0 20px;
          /* background: linear-gradient(90deg, #cedd58 0%, #224b21 90.91%); */
          /* background: linear-gradient(90deg, #012f00 0%, #224b21 90.91%); */
          background: linear-gradient(90deg, #012f00 0%, #689d19 90.91%);
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

        .asset-viewer {
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
          background-color: #224b21;
        }

        .personal-view {
          background-color: #689d19;
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
          background: var(--sl-color-tertiary-900);
          color: var(--sl-color-tertiary-50);
        }

        .asset-view-bar {
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
          width: 60px;
        }

        .entry-tab-bar-button:hover {
          background: var(--sl-color-tertiary-50);
          color: var(--sl-color-tertiary-950);
          /* margin: 0; */
          /* border-radius: 5px 0 0 5px; */
          /* height: 50px; */
        }

        .entry-tab-bar-button:focus-visible {
          background: var(--sl-color-tertiary-50);
          color: var(--sl-color-tertiary-950);
        }

        .entry-tab-bar-button img {
          filter: invert(1);
        }

        .entry-tab-bar-button:hover img {
          filter: none;
        }

        .entry-tab-bar-button:focus-visible img {
          filter: none;
        }

        .btn-selected {
          background: var(--sl-color-tertiary-50);
          color: var(--sl-color-tertiary-950);
          /* margin: 0;
          border-radius: 5px 0 0 5px;
          height: 50px; */
        }

        .btn-selected img {
          filter: none;
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
          background: linear-gradient(270deg, #142510 0%, #3a622d 100%);
          width: 74px;
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
          position: relative;
          background: #224b21;
          min-height: var(--sidebar-width);
          align-items: center;
          overflow-x: auto;
          -ms-overflow-style: none; /* IE and Edge */
          scrollbar-width: none; /* Firefox */
        }

        .top-bar::-webkit-scrollbar {
          display: none;
        }

        .personal-top-bar {
          background: #689d19;
        }

        .personal-view-indicator {
          position: absolute;
          top: 74px;
          left: 74px;
          font-size: 18px;
          background: #689d19;
          padding: 5px;
          border-radius: 0 0 10px 10px;
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
          background: linear-gradient(0deg, #203923 0%, #527a22 100%);
          box-shadow: 0px 4px 4px rgba(0, 0, 0, 0.25);
          border-radius: 5px;
        }

        .moss-button:hover {
          background: linear-gradient(0deg, #203923 0%, #63912a 100%);
          cursor: pointer;
        }
      `,
    ];
  }
}

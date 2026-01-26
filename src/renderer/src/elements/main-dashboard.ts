import { consume, provide } from '@lit/context';
import { classMap } from 'lit/directives/class-map.js';
import { state, customElement, query, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { encodeHashToBase64, DnaHash, decodeHashFromBase64, DnaHashB64 } from '@holochain/client';
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
import { mdiAccountLockOpen, mdiAccountMultiplePlus, mdiCog } from '@mdi/js';
import {
  AppletHash,
  AppletId,
  WAL,
  OpenAssetMode,
  WeaveLocation,
  weaveUrlToLocation,
  weaveUrlFromWal, decodeContext
} from '@theweave/api';
import { invitePropsToPartialModifiers } from '@theweave/utils';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

import '@theweave/elements/dist/elements/weave-client-context.js';
import '@theweave/elements/dist/elements/wal-to-pocket.js';

import '../personal-views/welcome-view/welcome-view.js';
import '../personal-views/activity-view/activity-view.js';
import '../personal-views/assets-graph/assets-graph.js';
import '../groups/elements/entry-title.js';
import './navigation/groups-sidebar.js';
import './navigation/personal-view-sidebar.js';
import './dialogs/join-group-dialog.js';
import '../layout/views/cross-group-main.js';
import '../personal-views/tool-library/tool-library-web2.js';
import '../layout/views/asset-view.js';
import '../groups/elements/group-container.js';
import './debugging-panel/debugging-panel.js';

import './_new_design/moss-dialog.js';
import './_new_design/moss-settings/moss-settings.js';

import { mossStyles } from '../shared-styles.js';
import { mossStoreContext } from '../context.js';
import { MossStore } from '../moss-store.js';
import { JoinGroupDialog } from './dialogs/join-group-dialog.js';
import { CreateGroupDialog } from './dialogs/create-group-dialog.js';

import './asset-tags/tag-selection-dialog.js';
import './pocket/pocket.js';
import './pocket/pocket-drop.js';
import './creatables/creatable-palette.js';
import { MossPocket } from './pocket/pocket.js';
import { CreatablePalette } from './creatables/creatable-palette.js';
import { appletMessageHandler, handleAppletIframeMessage } from '../applets/applet-host.js';
import { openViewsContext } from '../layout/context.js';
import { AppOpenViews } from '../layout/types.js';
import {
  progenitorFromProperties,
} from '../utils.js';
import { dialogMessagebox } from '../electron-api.js';
import { UpdateFeedMessage } from '../types.js';
import TimeAgo from 'javascript-time-ago';
import en from 'javascript-time-ago/locale/en';
import { ToolCompatibilityId } from '@theweave/moss-types';
import { AssetsGraph } from '../personal-views/assets-graph/assets-graph.js';
import { TagSelectionDialog } from './asset-tags/tag-selection-dialog.js';
import {
  appStoreIcon,
  chevronDoubleLeftIcon,
  chevronDoubleRightIcon,
  closeIcon,
  magnifyingGlassIcon,
  turingBlobIcon,
  turingBlobIconHover,
} from './_new_design/icons.js';
import { MossDialog } from './_new_design/moss-dialog.js';

TimeAgo.addDefaultLocale(en);

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
    toolCompatibilityId: ToolCompatibilityId;
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
  addGroupDialog!: MossDialog;

  @query('#settings-dialog')
  settingsDialog!: MossDialog;

  @query('#tag-selection-dialog')
  _tagSelectionDialog!: TagSelectionDialog;

  @query('#pocket')
  _pocket!: MossPocket;

  @query('#creatable-palette')
  _creatablePalette!: CreatablePalette;

  @property()
  initialGroup: DnaHash | undefined;

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
  _pocketDrop = false;

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

  @state()
  reloading = false;

  @state()
  slowLoading = false;

  @state()
  slowReloadTimeout: number | undefined;

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

  _draggedWal = new StoreSubscriber(
    this,
    () => this._mossStore.draggedWal(),
    () => [this._mossStore],
  );

  _addedToPocket = new StoreSubscriber(
    this,
    () => this._mossStore.addedToPocket(),
    () => [this._mossStore],
  );

  _allGroupHashes = new StoreSubscriber(
    this,
    () => this._mossStore.allGroupsDnaHashes,
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

  _reloadingApplets: Array<AppletId> = [];

  // _unlisten: UnlistenFn | undefined;

  @provide({ context: openViewsContext })
  @property()
  openViews: AppOpenViews = {
    openAppletMain: async (appletHash, _wal) => {
      const groupsForApplet = await toPromise(this._mossStore.groupsForApplet.get(appletHash));
      const groupDnaHashes = Array.from(groupsForApplet.keys());
      if (groupDnaHashes.length === 0) {
        notifyError(msg('Tool not found in any of your groups.'));
        throw new Error('Tool not found in any of your groups.');
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
    openCrossGroupMain: (_appletBundleHash) => {
      throw new Error('Opening cross-group main views is currently not implemented.');
    },
    openCrossGroupBlock: (_appletBundleHash, _block, _context) => {
      throw new Error('Opening cross-applet blocks is currently not implemented.');
    },
    openAsset: async (wal: WAL, mode?: OpenAssetMode) => {
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
    userSelectWal: async (from, groupDnaHash) => {
      if (from === 'create') {
        this._creatablePalette.show(groupDnaHash);
      } else {
          if (from == 'pocket-no-create') {
              this._pocket.show('select-no-create');
          } else {
              this._pocket.show('select');
          }
      }

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
    userSelectAssetRelationTag: async () => {
      this._tagSelectionDialog.show();

      return new Promise((resolve) => {
        const listener = (e) => {
          switch (e.type) {
            case 'cancel-select-asset-relation-tag':
              this.removeEventListener('cancel-select-asset-relation-tag', listener);
              return resolve(undefined);
            case 'asset-relation-tag-selected':
              const tag: string = e.detail;
              this.removeEventListener('asset-relation-tag-selected', listener);
              this._tagSelectionDialog.hide();
              return resolve(tag);
          }
        };
        this.addEventListener('asset-relation-tag-selected', listener);
        this.addEventListener('cancel-select-asset-relation-tag', listener);
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
    console.debug('getRelatedGroupsAndApplets', hrl);
    const first = this._mossStore.hrlLocations.get(hrl[0]);
    console.debug('getRelatedGroupsAndApplets first', first);
    const location = await toPromise(first.get(hrl[1]));
    if (!location) {
      return [[], []];
    }
    const appletContextHashes = [encodeHashToBase64(location.dnaLocation.appletHash)];
    const groupsForApplet = await toPromise(
      this._mossStore.groupsForApplet.get(location.dnaLocation.appletHash),
    );
    const groupDnaHashes = Array.from(groupsForApplet.keys());
    const groupContextHashesB64 = groupDnaHashes.map((hash) => encodeHashToBase64(hash));
    return [groupContextHashesB64, appletContextHashes];
  }

  async openTab(tabInfo: TabInfo, mode?: OpenAssetMode) {
    console.debug('openTab', tabInfo, mode);
    if (mode === 'window') throw Error("Mode 'window' cannot be opened in a tab");
    const alreadyOpen = Object.values(this._openTabs).find(
      (tabInfoExisting) => tabInfo.id === tabInfoExisting.id,
    );
    if (!alreadyOpen) {
      this._openTabs[tabInfo.id] = tabInfo;
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

  async handleOpenAppletMain(appletHash: AppletHash, wal?: WAL) {
    this.openViews.openAppletMain(appletHash, wal);
  }

  hardRefresh() {
    this.slowLoading = false;
    window.removeEventListener('beforeunload', this.beforeUnloadListener);
    // The logic to set this variable lives in walwindow.html
    if ((window as any).__WINDOW_CLOSING__) {
      (window as any).electronAPI.closeWindow();
    } else {
      window.location.reload();
    }
  }

  beforeUnloadListener = async (e) => {
    console.log('GOT BEFOREUNLOAD EVENT: ', e);
    // Wait first to check whether it's triggered by a will-navigate or will-frame-navigate
    // event to an external location (https, mailto, ...) and this listener should therefore
    // not be executed (https://github.com/electron/electron/issues/29921)
    let shouldProceed = true;
    await new Promise((resolve) => {
      window.electronAPI.onWillNavigateExternal(() => {
        shouldProceed = false;
        window.electronAPI.removeWillNavigateListeners();
        resolve(null);
      });
      setTimeout(() => {
        resolve(null);
      }, 500);
    });

    e.preventDefault();

    if (shouldProceed) {
      e.preventDefault();
      this.reloading = true;
      console.log('onbeforeunload event');
      // If it takes longer than 5 seconds to unload, offer to hard reload
      this.slowReloadTimeout = window.setTimeout(() => {
        this.slowLoading = true;
      }, 4500);
      await this._mossStore.iframeStore.postMessageToAppletIframes(
        { type: 'all' },
        { type: 'on-before-unload' },
      );
      console.log('on-before-unload callbacks finished.');
      window.removeEventListener('beforeunload', this.beforeUnloadListener);
      // The logic to set this variable lives in index.html
      window.location.reload();
      if ((window as any).__WINDOW_CLOSING__) {
        console.log('__WINDOW_CLOSING__ is true');
        window.electronAPI.closeMainWindow();
      } else {
        window.location.reload();
      }
    }
  };

  async firstUpdated() {
    if (this.initialGroup) this.openGroup(this.initialGroup);
    // add the beforeunload listener only 10 seconds later as there won't be anything
    // meaningful to save by applets before and it will ensure that the iframes
    // are ready to respond to the on-before-reload event
    setTimeout(() => {
      window.addEventListener('beforeunload', this.beforeUnloadListener);
    }, 10000);

    window.addEventListener('message', appletMessageHandler(this._mossStore, this.openViews));
    window.electronAPI.onAppletToParentMessage(async (_e, payload) => {
      if (!payload.message.source) throw new Error('source not defined in AppletToParentMessage');
      const response = await handleAppletIframeMessage(
        this._mossStore,
        this.openViews,
        payload.message.source,
        payload.message.request,
        'wal-window',
      );
      await window.electronAPI.appletMessageToParentResponse(response, payload.id);
    });

    // Received from WAL windows on request when the main window is reloaded
    window.electronAPI.onIframeStoreSync((_e, payload) => {
      const [appletIframes, crossGroupIframes] = payload;
      Object.entries(appletIframes).forEach(([appletId, iframes]) => {
        iframes.forEach(({ id, subType }) => {
          this._mossStore.iframeStore.registerAppletIframe(appletId, {id, subType, source: 'wal-window'});
        });
      });
      Object.entries(crossGroupIframes).forEach(([toolCompatibilityId, iframes]) => {
        iframes.forEach(({ id, subType }) => {
          this._mossStore.iframeStore.registerCrossGroupIframe(
            toolCompatibilityId,
            { id, subType, source: 'wal-window' },
          );
        });
      });
    });

    window.electronAPI.onSwitchToWeaveLocation((_, weaveLocation) => {
      if (weaveLocation) {
        if (weaveLocation.type === 'applet') {
            this.openViews.openAppletMain(weaveLocation.appletHash/*, weaveLocation.wal*/);
        } else if (weaveLocation.type === 'group') {
            this.openGroup(weaveLocation.dnaHash);
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

    window.electronAPI.onRequestFactoryReset(() => {
      this.settingsDialog.show();
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

    this._mossStore.on('open-asset', (wal) => {
      this.handleOpenWal(wal);
    });

    // setInterval(() => {
    //   const allIframes = getAllIframes();
    //   console.log('CURRENT IFRAME COUNT: ', allIframes.length);
    // }, 10000);

    this.appVersion = this._mossStore.version;

    // Fetch Moss update feed
    try {
      const response = await fetch(
        'https://raw.githubusercontent.com/lightningrodlabs/moss/main/news.json',
      );
      const updateFeed = await response.json();
      if (updateFeed['0.15.x']) {
        this._updateFeed = updateFeed['0.15.x'];
      }
    } catch (e) {
      console.warn('Failed to fetch update feed: ', e);
    }

    await window.electronAPI.requestIframeStoreSync();

    // Load all notifications for the last week
    await this._mossStore.loadNotificationFeed(7);
  }

  openClipboard() {
    this.showClipboard = true;
    this._pocket.show('open');
    this._pocket.focus();
  }

  openCreatablePanel() {
    this.showCreatablePanel = true;
    this._creatablePalette.show(this.selectedGroupDnaHash());
    this._creatablePalette.focus();
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
    // console.log('this._resizeDrawerX: ', this._resizeDrawerX);
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

  displayCrossGroupTool(toolCompatibilityId: ToolCompatibilityId) {
    return (
      this._dashboardState.value.viewType === 'personal' &&
      this._dashboardState.value.viewState.type === 'tool' &&
      this._dashboardState.value.viewState.toolCompatibilityId === toolCompatibilityId
    );
  }

  displayApplet(appletHash: AppletHash) {
    return (
      this._dashboardState.value.viewType === 'group' &&
      this._dashboardState.value.appletHash &&
      encodeHashToBase64(this._dashboardState.value.appletHash) === encodeHashToBase64(appletHash)
    );
  }

  displayGroupContainer(groupHash: DnaHash) {
    return (
      this._dashboardState.value.viewType === 'group' &&
      encodeHashToBase64(this._dashboardState.value.groupHash) === encodeHashToBase64(groupHash)
    );
  }

  selectedGroupDnaHash() {
    return this._dashboardState.value.viewType === 'group'
      ? this._dashboardState.value.groupHash
      : undefined;
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

  renderToolCrossGroupViews() {
    const personalToolView =
      this._dashboardState.value.viewType === 'personal' &&
      this._dashboardState.value.viewState.type === 'tool';
    switch (this._runningAppletClasses.value.status) {
      case 'pending':
        return personalToolView ? html`Loading running tool classes...` : html``;
      case 'error':
        return personalToolView
          ? html`Failed to get running tool classes: ${this._runningAppletClasses.value.error}`
          : html``;
      case 'complete':
        return repeat(
          Object.keys(this._runningAppletClasses.value.value),
          (toolCompatibilityId) => toolCompatibilityId,
          (toolCompatibilityId) => html`
            <cross-group-main
              .toolCompatibilityId=${toolCompatibilityId}
              style="flex: 1; ${this.displayCrossGroupTool(toolCompatibilityId)
              ? ''
              : 'display: none;'}
                ${this._drawerResizing ? 'pointer-events: none; user-select: none;' : ''}
                overflow-x: auto;"
            ></cross-group-main>
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

      <assets-graph
        id="assets-graph"
        style="${this.displayMossView('assets-graph')
        ? 'display: flex; flex: 1;'
        : 'display: none;'}${this._drawerResizing
          ? 'pointer-events: none; user-select: none;'
          : ''} overflow-x: hidden;"
      ></assets-graph>

      <activity-view
        @open-wal=${async (e) => {
        await this.handleOpenWal(e.detail);
      }}
        @open-applet-main=${(e: CustomEvent) => {
        this.openViews.openAppletMain(e.detail.applet, e.detail.wal);
      }}
        style="${this.displayMossView('activity-view')
        ? 'display: flex; flex: 1;'
        : 'display: none;'}${this._drawerResizing
          ? 'pointer-events: none; user-select: none;'
          : ''} overflow-x: hidden; overflow-y: auto;"
      ></activity-view>

      <tool-library-web2
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
      ></tool-library-web2>
    `;
  }

  renderGroupArea() {
    switch (this._allGroupHashes.value.status) {
      case 'pending':
        return html`loading groups...`;
      case 'error':
        return html`error: ${this._allGroupHashes.value.error}`;
      case 'complete':
        return html`
          ${repeat(
          this._allGroupHashes.value.value,
          (group) => encodeHashToBase64(group),
          (groupHash) => html`
              <group-context .groupDnaHash=${groupHash}>
                <group-container
                  class="group-container"
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
                  @group-selected=${(e: CustomEvent) => {
              this.openGroup(e.detail.groupDnaHash);
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
              this.openViews.openAppletMain(e.detail.appletHash);
            }}
                  @add-tool-requested=${() => {
              this._mossStore.setDashboardState({
                viewType: 'personal',
                viewState: {
                  type: 'moss',
                  name: 'tool-library',
                },
              });
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
            style="overflow: auto; display: flex; flex: 1; ${this._selectedTab &&
            this._selectedTab.id === tab.id
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
            this.openViews.openAppletMain(e.detail.applet, e.detail.wal);
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
        ${closeIcon(36)}
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
      <moss-dialog headerAlign="center" id="add-group-dialog" width="670px">
        
          <span slot="header">${msg('Add Group')}</span>
          
        <div class="row" slot="content" style="justify-content:space-between">
          <button
            class="moss-button"
            style="margin: 0 5px; padding: 5px 10px;"
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
          </button>
          <button
            class="moss-button"
            style="margin: 0 5px; padding: 5px 10px;"
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
          </button>
        </div>
      </moss-dialog>
    `;
  }
  isLibrarySelected(): boolean {
    return (
      this._dashboardState.value.viewType === 'personal' &&
      this._dashboardState.value.viewState.type === 'moss' &&
      this._dashboardState.value.viewState.name === 'tool-library'
    );
  }
  render() {
    return html`
      <img
        src="turing-pattern-bottom-left.svg"
        style="position: fixed; bottom: 0; left: 0; height: 250px;"
      />
      <moss-dialog id="settings-dialog" width="700px">
        <span slot="header">${msg('Settings')}</span>
        <div slot="content">
          <moss-settings></moss-settings>
        </div>
      </moss-dialog>
      <tag-selection-dialog
        id="tag-selection-dialog"
        @asset-relation-tag-selected=${(e) => {
        this.dispatchEvent(
          new CustomEvent('asset-relation-tag-selected', {
            detail: e.detail,
            bubbles: false,
            composed: false,
          }),
        );
      }}
        @sl-hide=${(_e) => {
        this.dispatchEvent(
          new CustomEvent('cancel-select-asset-relation-tag', {
            bubbles: false,
            composed: false,
          }),
        );
        this.showClipboard = false;
      }}
      ></tag-selection-dialog>
      <moss-pocket
        id="pocket"
        @click=${(e) => e.stopPropagation()}
        @open-wal=${async (e) => await this.handleOpenWal(e.detail.wal)}
        @open-wurl=${async (e) => await this.handleOpenWurl(e.detail.wurl)}
        @open-creatable-palette=${() => this._creatablePalette.show(this.selectedGroupDnaHash())}
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
      <creatable-palette
        id="creatable-palette"
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
      ></creatable-palette>

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
        ? 'top-8'
        : 'personal-view'}"
      >
        <div
          class="library-viewer invisible-scrollbars column ${this._dashboardState.value
        .viewType === 'personal' &&
        this._dashboardState.value.viewState.type == 'moss' &&
        this._dashboardState.value.viewState.name === 'tool-library'
        ? 'top-80'
        : 'personal-view'}"
        ></div>
        <div
          class="row"
          style="flex: 1; ${this._assetViewerState.value.visible &&
        this._dashboardState.value.viewType === 'personal'
        ? 'max-height: calc(100vh - 124px);'
        : ''} ${this._assetViewerState.value.visible &&
          this._dashboardState.value.viewType === 'group'
          ? 'max-height: calc(100vh - 66px)'
          : ''}"
        >
          <!-- PERSONAL VIEW -->
          ${this.renderToolCrossGroupViews()} ${this.renderMossViews()}

          <!-- GROUP VIEW -->
          <div
            id="group-view-area ${this._dashboardState.value.viewType === 'personal'
        ? 'height-constrained'
        : ''}"
            style="${this._dashboardState.value.viewType === 'group'
        ? 'display: flex; flex: 1;'
        : 'display: none;'}${this._drawerResizing
          ? 'pointer-events: none; user-select: none;'
          : ''} overflow-x: auto;"
          >
            ${this.renderGroupArea()}
          </div>
          <div
            class="drawer-separator"
            style="${this._assetViewerState.value.visible ? '' : 'display: none;'}"
            @mousedown=${(e) => {
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
        'drawer-height-constrained': this._dashboardState.value.viewType === 'personal',
      })}"
            style="${this._drawerResizing ? 'pointer-events: none; user-select: none;' : ''}${this
        ._assetViewerState.value.visible && this._assetViewerState.value.position === 'side'
        ? `width: ${this._drawerWidth > 200 ? this._drawerWidth : 200
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
      <div
        @dragover=${(e: DragEvent) => {
        e.preventDefault();
      }}
        @drop=${(e: any) => {
        console.log('GOT DROP EVENT: ', e);
      }}
        class="column left-sidebar items-center"
      >
        <div class="column items-center sidebar-items">
          <button
            class="home-button ${this._dashboardState.value.viewType === 'personal'
        ? 'selected'
        : ''}"
            style="margin-top: 25px;"
            .selected=${false}
            .tooltipText=${msg('Home')}
            placement="bottom"
            @click=${() => {
        this._mossStore.setDashboardState({
          viewType: 'personal',
          viewState: { type: 'moss', name: 'welcome' },
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
            <div class="column center-content">
              <img src="moss-m-white.svg" style="width: 38px; height: 38px;" />
            </div>
          </button>

          <button
            class="moss-sidebar-button"
            style="margin-top: 8px;"
            @click=${() => this.openClipboard()}
            @keypress=${(e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          this.openClipboard();
        }
      }}
          >
            <div class="column center-content">${magnifyingGlassIcon(20)}</div>
          </button>
          <sl-tooltip .content="${msg('Tool Library')}" placement="right" hoist>
            <button
              class="moss-sidebar-button ${this.isLibrarySelected() ? 'library-selected' : ''}"
              style="position: relative;"
              @click=${() => {
        this._mossStore.setDashboardState({
          viewType: 'personal',
          viewState: {
            type: 'moss',
            name: 'tool-library',
          },
        });
      }}
            >
              <div class="column center-content">${appStoreIcon(30)}</div>
            </button>
          </sl-tooltip>
          ${this.isLibrarySelected() ? html`<div class="indicator"></div>` : ''}
          <sl-tooltip .content="${msg('Settings')}" placement="right" hoist>
            <button
              class="moss-sidebar-button"
              @click=${() => this.settingsDialog.show()}
            >
              <div class="column center-content">
                <sl-icon .src=${wrapPathInSvg(mdiCog)} style="font-size: 24px;"></sl-icon>
              </div>
            </button>
          </sl-tooltip>
        </div>

        <div class="sidebar-divider" style="margin-top: 8px;"></div>

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
        (this.shadowRoot?.getElementById('add-group-dialog') as MossDialog).show()}
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
              class="create-asset-btn"
              style="all: unset; cursor: pointer;"
              @click=${() => this.openCreatablePanel()}
              @keypress=${(e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          this.openCreatablePanel();
        }
      }}
            >
              <div class="column center-content default-image">${turingBlobIcon()}</div>
              <div class="column center-content hover-image">${turingBlobIconHover()}</div>
            </button>
          </sl-tooltip>
        </div>
        <div
          @dblclick=${() => this.openZomeCallPanel()}
          style="color: white; text-align: center; margin-bottom: 3px;"
          title=${this.appVersion ? `Moss version ${this.appVersion}` : ``}
        >
          ${this.appVersion ? `v${this.appVersion}` : ''}
        </div>
      </div>

      ${this.hoverPersonalView && this._dashboardState.value.viewType === 'group'
        ? html`<div class="personal-view-indicator">${msg('switch to personal view')}</div>`
        : html``}

      <!-- TOP BAR -->
      ${this._dashboardState.value.viewType === 'personal'
        ? html`
            <div
              class="top-bar row personal-top-bar"
              style="flex: 1; position: fixed; left: var(--sidebar-width); top: 8px; right: 8px;"
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
                style="overflow-x: auto; padding-right: 40px; height: 80px;"
                @wheel=${(e) => {
            const el = this.shadowRoot!.getElementById('top-bar-scroller');
            if (el)
              el.scrollBy({
                left: e.deltaY < 0 ? -30 : 30,
              });
          }}
              >
                <personal-view-sidebar
                  style="margin-left: 12px; flex: 1; overflow-x: sroll; padding-left: 4px;"
                  .selectedView=${this._dashboardState.value.viewState}
                  @personal-view-selected=${async (e) => {
            console.log('@personal-view-selected: ', e);
            this._mossStore.setDashboardState({
              viewType: 'personal',
              viewState: e.detail,
            });
            if (e.detail.type === 'moss' && e.detail.name === 'assets-graph') {
              const assetsGraphEl = this.shadowRoot!.getElementById('assets-graph') as
                | AssetsGraph
                | null
                | undefined;
              if (assetsGraphEl) {
                await assetsGraphEl.load();
              }
            }
          }}
                ></personal-view-sidebar>
              </div>
              <div style="display: flex; flex: 1;"></div>
            </div>
          `
        : html``}

      <!-- ASSET VIEWER TOGGLE -->

      <div class="row" style="position: fixed; top: 0; right: 0;">
        <sl-tooltip
          content="${this._assetViewerState.value.visible
        ? 'Hide Asset Viewer'
        : 'Show Asset Viewer'}"
          placement="left"
          hoist
        >
          <button
            id="tab-bar-button"
            class="asset-viever-toggle-btn ${this._assetViewerState.value.visible &&
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
              ${this._assetViewerState.value.visible
        ? chevronDoubleRightIcon(18)
        : chevronDoubleLeftIcon(18)}
            </div>
          </button>
        </sl-tooltip>
      </div>

      <!-- Reloading overlay -->
      <div
        class="overlay column center-content reloading-overlay"
        style="${this.reloading ? '' : 'display: none;'}"
      >
        <img src="loading_animation.svg" />
        <div style="margin-left: 10px; font-size: 18px; color: #142510">
          ${this.reloading ? msg('reloading...') : msg('loading...')}
        </div>
        ${this.slowLoading
        ? html`
              <div class="column items-center" style="margin-top: 50px; max-width: 600px;">
                <div>
                  One or more Tools take unusually long to unload. Do you want to force reload?
                </div>
                <div style="margin-top: 10px; margin-bottom: 20px;">
                  (<b>Warning:</b> Force reloading may interrupt the Tool from saving unsaved
                  content)
                </div>
                <button
                  class="moss-button"
                  @click=${() => this.hardRefresh()}
                  style="margin-top: 20px; width: 150px;"
                >
                  Force Reload
                </button>
              </div>
            `
        : html``}
      </div>

      <!-- Added to pocket indicator -->
      ${this._addedToPocket.value
        ? html`
            <div
              class="row items-center"
              style="position: fixed; left: 60px; top: 68px; cursor: default;"
              @click=${() => this.openClipboard()}
            >
              <div class="arrow-left" style="z-index: 1;"></div>
              <div class="row items-center justify-center added-to-pocket">
                <img style="height: 30px;" src="pocket_black.png" />
                <span style="margin-left: 10px;">${msg('Added to Pocket')}</span>
              </div>
            </div>
          `
        : html``}

      <!-- POCKET OVERLAY -->
      <!-- disabled for now because it's not working across origins. Possible workaround: https://github.com/James-E-Adams/iframe-drag-n-drop -->
      <!-- ${this._draggedWal.value
        ? html` <div class="overlay column">
            <pocket-drop class="flex flex-1" style="z-index: 999;"></pocket-drop>
          </div>`
        : html``} -->
    `;
  }

  static get styles() {
    return [
      mossStyles,
      css`
        :host {
          flex: 1;
          display: flex;
        }

        .overlay {
          position: fixed;
          top: 0;
          bottom: 0;
          left: 0;
          right: 0;
          background: #ffffff00;
          z-index: 99;
          display: flex;
        }

        .reloading-overlay {
          background: url(Moss-launch-background.png);
          background-size: cover;
        }

        /* .esc-pocket-msg {
          position: fixed;
          top: 13px;
          left: 15px;
          font-size: 23px;
          color: white;
        } */

        /* .close-overlay-btn {
          all: unset;
          color: white;
          cursor: pointer;
          position: fixed;
          top: 10px;
          right: 20px;
          font-size: 60px;
          font-weight: 500;
        } */

        /* .close-overlay-btn:hover {
          color: #c3ffc7;
        } */

        .arrow-left {
          width: 0;
          height: 0;
          border-top: 15px solid transparent;
          border-bottom: 15px solid transparent;
          border-right: 15px solid #dbe755;
        }

        .added-to-pocket {
          padding: 20px 5px;
          border-radius: 10px;
          background: #dbe755;
          min-width: 200px;
          box-shadow: 0 0 2px 2px #042007b4;
        }

        .hidden {
          display: none;
        }

        .home-button {
          all: unset;
          /* background: linear-gradient(0deg, #203923 0%, #527a22 100%); */
          /* background: var(--moss-dark-button); */
          background: none;
          border-radius: 8px;
          width: 48px;
          height: 48px;
          cursor: pointer;
          color: white;
        }

        .home-button:hover {
          background: var(--moss-dark-button);
        }

        .home-button:focus-visible {
          outline: 2px solid var(--moss-purple);
        }

        .selected {
          color: black;
          background: var(--moss-dark-button);
        }

        .library-selected {
          border: solid 4px var(--moss-main-green);
          color: black;
          background: var(--moss-main-green);
        }

        .library-selected:hover {
          color: black;
          background: var(--moss-main-green);
        }

        .indicator {
          position: absolute;
          right: 0px;
          top: 146px;
          height: 20px;
          border-radius: 2px;
          width: 12px;
          background-image: url(indicator.svg);
        }
        .moss-sidebar-items {
          position: relative;
        }

        .sidebar-divider {
          width: 40px;
          height: 1px;
          background: white;
          opacity: 0.4;
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
          width: 4px;
          background: var(--sl-color-tertiary-200);
          cursor: col-resize;
          z-index: 1000;
        }

        .side-drawer {
          position: relative;
          background: var(--sl-color-tertiary-0);
          border-top: 4px solid var(--sl-color-tertiary-50);
        }

        .drawer-height-constrained {
          max-height: calc(100vh - 142px);
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
          top: 80px;
          left: 80px;
          bottom: 8px;
          right: 8px;
          /* background-color: #224b21; */
          background-color: var(--moss-main-green);
          border-radius: 0 0 10px 10px;
          overflow: hidden;
        }

        .library-viewer {
          /* display: flex; */
          flex: 1;
          position: fixed;
          top: 180px;
          left: 80px;
          bottom: 8px;
          right: 8px;
          /* background-color: #224b21; */
          background-color: var(--moss-main-green);
          border-radius: 0 0 10px 10px;
          overflow-x: auto;
        }

        .top-8 {
          top: 8px;
          border-radius: 10px;
        }

        .top-80 {
          top: 80px;
          border-radius: 10px;
        }

        .group-container {
          display: flex;
          padding: 8px 8px 8px 0;
        }

        .personal-view {
          /* background-color: #689d19; */
          /* background-color: var(--moss-dark-green); */
          background: none;
        }

        #group-view-area {
          overflow: hidden;
        }

        .height-constrained {
          max-height: calc(100vh - 70px);
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
          border-radius: 5px 0 5px 5px;
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

        .asset-viever-toggle-btn {
          all: unset;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: row;
          color: var(--moss-purple  );
          cursor: pointer;
          margin: 8px;
          height: 25px;
          width: 25px;
          border-radius: 5px 0 0 5px;
        }

        .asset-viever-toggle-btn:hover {
          background: var(--sl-color-tertiary-50);
          color: var(--sl-color-tertiary-950);
          /* margin: 0; */
          /* border-radius: 5px 0 0 5px; */
          /* height: 50px; */
        }

        .asset-viever-toggle-btn:focus-visible {
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
          /* background: linear-gradient(270deg, #142510 0%, #3a622d 100%); */
          width: 80px;
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
          /* background: #224b21; */
          background: var(--moss-main-green);
          min-height: var(--sidebar-width);
          align-items: center;
          overflow-x: auto;
          -ms-overflow-style: none; /* IE and Edge */
          scrollbar-width: none; /* Firefox */
          border-radius: 12px 12px 0 0;
        }

        .top-bar::-webkit-scrollbar {
          display: none;
        }

        .personal-top-bar {
          background: transparent;
          border-radius: 0;
        }

        .personal-view-indicator {
          position: absolute;
          top: 80px;
          left: 80px;
          font-size: 18px;
          background: #689d19;
          padding: 5px;
          border-radius: 0 0 10px 10px;
        }

        /* Create New Asset Button */

        .create-asset-btn .default-image {
          display: block;
        }

        .create-asset-btn .hover-image {
          display: none;
        }

        .create-asset-btn:hover .default-image,
        .create-asset-btn:focus-visible .default-image {
          display: none;
        }

        .create-asset-btn:hover .hover-image,
        .create-asset-btn:focus-visible .hover-image {
          display: block;
        }
      `,
    ];
  }
}

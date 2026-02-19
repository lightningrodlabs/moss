// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
// IPC_CHANGE_HERE
import { ActionHashB64, AgentPubKeyB64, CallZomeRequest, DnaHashB64 } from '@holochain/client';
import { contextBridge, ipcRenderer } from 'electron';
import {
  AppletId,
  AppletToParentMessage,
  FrameNotification,
  GroupProfile,
  ParentToAppletMessage,
  WAL,
  WeaveLocation,
} from '@theweave/api';
import {
  AppHashes,
  DistributionInfo,
  ResourceLocation,
  ToolCompatibilityId,
} from '@theweave/moss-types';
import { ProgressInfo } from 'electron-updater';

contextBridge.exposeInMainWorld('__HC_ZOME_CALL_SIGNER__', {
  signZomeCall: (request: CallZomeRequest) => ipcRenderer.invoke('sign-zome-call', request),
});

contextBridge.exposeInMainWorld('electronAPI', {
  signZomeCallApplet: (request: CallZomeRequest) =>
    ipcRenderer.invoke('sign-zome-call-applet', request),
  appletMessageToParentResponse: (response: any, id: string) =>
    ipcRenderer.invoke('applet-message-to-parent-response', response, id),
  parentToAppletMessage: (message: ParentToAppletMessage, forApplet: AppletId) =>
    ipcRenderer.invoke('parent-to-applet-message', message, forApplet),
  dialogMessagebox: (options: Electron.MessageBoxOptions) =>
    ipcRenderer.invoke('dialog-messagebox', options),
  installApp: (filePath: string, appId: string, networkSeed?: string) =>
    ipcRenderer.invoke('install-app', filePath, appId, networkSeed),
  lairSetupRequired: () => ipcRenderer.invoke('lair-setup-required'),
  launch: () => ipcRenderer.invoke('launch'),
  isAppletDev: () => ipcRenderer.invoke('is-applet-dev'),
  appletDevConfig: () => ipcRenderer.invoke('applet-dev-config'),
  factoryReset: () => ipcRenderer.invoke('factory-reset'),
  openLogs: () => ipcRenderer.invoke('open-logs'),
  exportLogs: () => ipcRenderer.invoke('export-logs'),
  onMossUpdateProgress: (callback: (e: Electron.IpcRendererEvent, payload: ProgressInfo) => any) =>
    ipcRenderer.on('moss-update-progress', callback),
  onRequestFactoryReset: (callback: (e: Electron.IpcRendererEvent) => any) =>
    ipcRenderer.on('request-factory-reset', callback),
  onAppletToParentMessage: (
    callback: (
      e: Electron.IpcRendererEvent,
      payload: { message: AppletToParentMessage; id: string },
    ) => any,
  ) => ipcRenderer.on('applet-to-parent-message', callback),
  onDeepLinkReceived: (callback: (e: Electron.IpcRendererEvent, payload: string) => any) =>
    ipcRenderer.on('deep-link-received', callback),
  onSwitchToWeaveLocation: (
    callback: (e: Electron.IpcRendererEvent, payload: WeaveLocation) => any,
  ) => ipcRenderer.on('switch-to-weave-location', callback),
  onWindowClosing: (callback: (e: Electron.IpcRendererEvent) => any) =>
    ipcRenderer.on('window-closing', callback),
  onWillNavigateExternal: (callback: (e: Electron.IpcRendererEvent) => any) =>
    ipcRenderer.on('will-navigate-external', callback),
  onIframeStoreSync: (callback: (e: Electron.IpcRendererEvent) => any) =>
    ipcRenderer.on('iframe-store-sync', callback),
  requestIframeStoreSync: () => ipcRenderer.invoke('request-iframe-store-sync'),
  removeWillNavigateListeners: () => ipcRenderer.removeAllListeners('will-navigate-external'),
  closeMainWindow: () => ipcRenderer.invoke('close-main-window'),
  openApp: (appId: string) => ipcRenderer.invoke('open-app', appId),
  openAppStore: () => ipcRenderer.invoke('open-appstore'),
  openWalWindow: (iframeSrc: string, appletId: AppletId, groupId: DnaHashB64, wal: WAL) => {
    ipcRenderer.invoke('open-wal-window', iframeSrc, appletId, groupId, wal)
  },
  getAllAppAssetsInfos: () => ipcRenderer.invoke('get-all-app-assets-infos'),
  getAppletDevPort: (lowerCaseAppletIdB64: string) =>
    ipcRenderer.invoke('get-applet-dev-port', lowerCaseAppletIdB64),
  getAppletIframeScript: () => ipcRenderer.invoke('get-applet-iframe-script'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),
  getConductorInfo: () => ipcRenderer.invoke('get-conductor-info'),
  storeGroupProfile: (groupDnaHashB64: DnaHashB64, groupProfile: GroupProfile) =>
    ipcRenderer.invoke('store-group-profile', groupDnaHashB64, groupProfile),
  getGroupProfile: (groupDnaHashB64: DnaHashB64) =>
    ipcRenderer.invoke('get-group-profile', groupDnaHashB64),
  getToolIcon: (toolId: string, resourceLocation?: ResourceLocation) =>
    ipcRenderer.invoke('get-tool-icon', toolId, resourceLocation),
  mossUpdateAvailable: () => ipcRenderer.invoke('moss-update-available'),
  installMossUpdate: () => ipcRenderer.invoke('install-moss-update'),
  installAppletBundle: (
    appId: string,
    networkSeed: string,
    agentPubKey: AgentPubKeyB64,
    happOrWebHappUrl: string,
    distributionInfo: DistributionInfo,
    appHashes: AppHashes,
    uiPort?: number,
  ) =>
    ipcRenderer.invoke(
      'install-applet-bundle',
      appId,
      networkSeed,
      agentPubKey,
      happOrWebHappUrl,
      distributionInfo,
      appHashes,
      uiPort,
    ),
  uninstallAppletBundle: (appId: string) => ipcRenderer.invoke('uninstall-applet-bundle', appId),
  isDevModeEnabled: () => ipcRenderer.invoke('is-dev-mode-enabled'),
  isMainWindowFocused: () => ipcRenderer.invoke('is-main-window-focused'),
  joinGroup: (networkSeed: string, progenitor: AgentPubKeyB64 | undefined) =>
    ipcRenderer.invoke('join-group', networkSeed, progenitor),
  installGroupHapp: (useProgenitor: boolean) =>
    ipcRenderer.invoke('install-group-happ', useProgenitor),
  notification: (
    notification: FrameNotification,
    showInSystray: boolean,
    notifyOS: boolean,
    weaveLocation: WeaveLocation | undefined,
    appletName: string | undefined,
  ) =>
    ipcRenderer.invoke(
      'notification',
      notification,
      showInSystray,
      notifyOS,
      weaveLocation,
      appletName,
    ),
  enableDevMode: () => ipcRenderer.invoke('enable-dev-mode'),
  disableDevMode: () => ipcRenderer.invoke('disable-dev-mode'),
  fetchIcon: (appActionHashB64: ActionHashB64) =>
    ipcRenderer.invoke('fetch-icon', appActionHashB64),
  selectScreenOrWindow: () => ipcRenderer.invoke('select-screen-or-window'),
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  getFeedbackWorkerUrl: () => ipcRenderer.invoke('get-feedback-worker-url'),
  saveFeedback: (feedback: {
    text: string;
    screenshot: string;
    mossVersion: string;
    os: string;
    timestamp: number;
    issueUrl?: string;
  }) => ipcRenderer.invoke('save-feedback', feedback),
  listFeedback: () => ipcRenderer.invoke('list-feedback'),
  getFeedback: (id: string) => ipcRenderer.invoke('get-feedback', id),
  updateFeedbackIssueUrl: (id: string, issueUrl: string) =>
    ipcRenderer.invoke('update-feedback-issue-url', id, issueUrl),
  batchUpdateAppletUis: (
    toolCompatibilityId: ToolCompatibilityId,
    happOrWebHappUrl: string,
    distributionInfo: DistributionInfo,
    sha256Happ: string,
    sha256Ui: string,
    sha256Webhapp: string,
  ) =>
    ipcRenderer.invoke(
      'batch-update-applet-uis',
      toolCompatibilityId,
      happOrWebHappUrl,
      distributionInfo,
      sha256Happ,
      sha256Ui,
      sha256Webhapp,
    ),
  updateAppletUi: (
    appId: string,
    happOrWebHappUrl: string,
    distributionInfo: DistributionInfo,
    sha256Happ: string,
    sha256Ui: string,
    sha256Webhapp: string,
  ) =>
    ipcRenderer.invoke(
      'update-applet-ui',
      appId,
      happOrWebHappUrl,
      distributionInfo,
      sha256Happ,
      sha256Ui,
      sha256Webhapp,
    ),
  uninstallApplet: (appId: string) => ipcRenderer.invoke('uninstall-applet', appId),
  dumpNetworkStats: () => ipcRenderer.invoke('dump-network-stats'),
  getRendererProcessMemory: async () => {
    const memInfo = await process.getProcessMemoryInfo();
    return {
      residentSetKB: memInfo.residentSet,
      privateKB: memInfo.private,
      sharedKB: memInfo.shared,
    };
  },
  getMainProcessMemory: () => ipcRenderer.invoke('get-main-process-memory'),
  fetchAndValidateHappOrWebhapp: (url: string) =>
    ipcRenderer.invoke('fetch-and-validate-happ-or-webhapp', url),
  validateHappOrWebhapp: (bytes: number[]) => ipcRenderer.invoke('validate-happ-or-webhapp', bytes),
  // Dev UI Override
  selectDevUiWebhapp: () => ipcRenderer.invoke('select-dev-ui-webhapp'),
  setDevUiOverride: (appId: string, webhappPath: string) =>
    ipcRenderer.invoke('set-dev-ui-override', appId, webhappPath),
  clearDevUiOverride: (appId: string) => ipcRenderer.invoke('clear-dev-ui-override', appId),
  getDevUiOverride: (appId: string) => ipcRenderer.invoke('get-dev-ui-override', appId),
});

declare global {
  interface Window {
    electronAPI: unknown;
  }
}

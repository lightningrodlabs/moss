// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
// IPC_CHANGE_HERE
import {
  ActionHashB64,
  AgentPubKeyB64,
  CallZomeRequest,
  DnaHashB64,
  FunctionName,
  ZomeName,
} from '@holochain/client';
import { contextBridge, ipcRenderer } from 'electron';
import { DistributionInfo } from '../main/filesystem';
import {
  AppletId,
  AppletToParentMessage,
  FrameNotification,
  ParentToAppletMessage,
  WAL,
} from '@theweave/api';
import { AppHashes } from '@theweave/moss-types';
import { ProgressInfo } from '@matthme/electron-updater';

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
  isAppletDev: () => ipcRenderer.invoke('is-applet-dev'),
  onMossUpdateProgress: (callback: (e: Electron.IpcRendererEvent, payload: ProgressInfo) => any) =>
    ipcRenderer.on('moss-update-progress', callback),
  onAppletToParentMessage: (
    callback: (
      e: Electron.IpcRendererEvent,
      payload: { message: AppletToParentMessage; id: string },
    ) => any,
  ) => ipcRenderer.on('applet-to-parent-message', callback),
  onDeepLinkReceived: (callback: (e: Electron.IpcRendererEvent, payload: string) => any) =>
    ipcRenderer.on('deep-link-received', callback),
  onSwitchToApplet: (callback: (e: Electron.IpcRendererEvent, payload: AppletId) => any) =>
    ipcRenderer.on('switch-to-applet', callback),
  onWindowClosing: (callback: (e: Electron.IpcRendererEvent) => any) =>
    ipcRenderer.on('window-closing', callback),
  onZomeCallSigned: (
    callback: (
      e: Electron.IpcRendererEvent,
      payload: {
        cellIdB64: [DnaHashB64, AgentPubKeyB64];
        fnName: FunctionName;
        zomeName: ZomeName;
      },
    ) => any,
  ) => ipcRenderer.on('zome-call-signed', callback),
  closeMainWindow: () => ipcRenderer.invoke('close-main-window'),
  openApp: (appId: string) => ipcRenderer.invoke('open-app', appId),
  openAppStore: () => ipcRenderer.invoke('open-appstore'),
  openWalWindow: (iframeSrc: string, appletId: AppletId, wal: WAL) =>
    ipcRenderer.invoke('open-wal-window', iframeSrc, appletId, wal),
  getAllAppAssetsInfos: () => ipcRenderer.invoke('get-all-app-assets-infos'),
  getAppletDevPort: (lowerCaseAppletIdB64: string) =>
    ipcRenderer.invoke('get-applet-dev-port', lowerCaseAppletIdB64),
  getAppletIframeScript: () => ipcRenderer.invoke('get-applet-iframe-script'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),
  getConductorInfo: () => ipcRenderer.invoke('get-conductor-info'),
  mossUpdateAvailable: () => ipcRenderer.invoke('moss-update-available'),
  installMossUpdate: () => ipcRenderer.invoke('install-moss-update'),
  installAppletBundle: (
    appId: string,
    networkSeed: string,
    membraneProofs: any,
    agentPubKey: AgentPubKeyB64,
    happOrWebHappUrl: string,
    distributionInfo: DistributionInfo,
    appHashes: AppHashes,
    metadata?: string,
  ) =>
    ipcRenderer.invoke(
      'install-applet-bundle',
      appId,
      networkSeed,
      membraneProofs,
      agentPubKey,
      happOrWebHappUrl,
      distributionInfo,
      appHashes,
      metadata,
    ),
  uninstallAppletBundle: (appId: string) => ipcRenderer.invoke('uninstall-applet-bundle', appId),
  isDevModeEnabled: () => ipcRenderer.invoke('is-dev-mode-enabled'),
  isMainWindowFocused: () => ipcRenderer.invoke('is-main-window-focused'),
  joinGroup: (networkSeed: string, progenitor: AgentPubKeyB64 | undefined) =>
    ipcRenderer.invoke('join-group', networkSeed, progenitor),
  createGroup: (useProgenitor: boolean) => ipcRenderer.invoke('create-group', useProgenitor),
  notification: (
    notification: FrameNotification,
    showInSystray: boolean,
    notifyOS: boolean,
    appletId: AppletId | undefined,
    appletName: string | undefined,
  ) =>
    ipcRenderer.invoke('notification', notification, showInSystray, notifyOS, appletId, appletName),
  enableDevMode: () => ipcRenderer.invoke('enable-dev-mode'),
  disableDevMode: () => ipcRenderer.invoke('disable-dev-mode'),
  fetchIcon: (appActionHashB64: ActionHashB64) =>
    ipcRenderer.invoke('fetch-icon', appActionHashB64),
  selectScreenOrWindow: () => ipcRenderer.invoke('select-screen-or-window'),
  batchUpdateAppletUis: (
    originalToolActionHash: ActionHashB64,
    newToolVersionActionHash: ActionHashB64,
    happOrWebHappUrl: string,
    distributionInfo: DistributionInfo,
    sha256Happ: string,
    sha256Ui: string,
    sha256Webhapp: string,
  ) =>
    ipcRenderer.invoke(
      'batch-update-applet-uis',
      originalToolActionHash,
      newToolVersionActionHash,
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
  fetchAndValidateHappOrWebhapp: (url: string) =>
    ipcRenderer.invoke('fetch-and-validate-happ-or-webhapp', url),
  validateHappOrWebhapp: (bytes: number[]) => ipcRenderer.invoke('validate-happ-or-webhapp', bytes),
});

declare global {
  interface Window {
    electronAPI: unknown;
  }
}

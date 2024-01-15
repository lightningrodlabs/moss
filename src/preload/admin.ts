// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
// IPC_CHANGE_HERE
import { ActionHashB64, AgentPubKeyB64 } from '@holochain/client';
import { contextBridge, ipcRenderer } from 'electron';
import { ZomeCallUnsignedNapi } from 'hc-we-rust-utils';
import { DistributionInfo } from '../main/filesystem';

contextBridge.exposeInMainWorld('electronAPI', {
  signZomeCall: (zomeCall: ZomeCallUnsignedNapi) => ipcRenderer.invoke('sign-zome-call', zomeCall),
  dialogMessagebox: (options: Electron.MessageBoxOptions) =>
    ipcRenderer.invoke('dialog-messagebox', options),
  installApp: (filePath: string, appId: string, networkSeed?: string) =>
    ipcRenderer.invoke('install-app', filePath, appId, networkSeed),
  isAppletDev: () => ipcRenderer.invoke('is-applet-dev'),
  // uninstallApp: (appId: string) => ipcRenderer.invoke('uninstall-app', appId),
  openApp: (appId: string) => ipcRenderer.invoke('open-app', appId),
  openAppStore: () => ipcRenderer.invoke('open-appstore'),
  openDevHub: () => ipcRenderer.invoke('open-devhub'),
  getAllAppAssetsInfos: () => ipcRenderer.invoke('get-all-app-assets-infos'),
  getAppletDevPort: (lowerCaseAppletIdB64: string) =>
    ipcRenderer.invoke('get-applet-dev-port', lowerCaseAppletIdB64),
  getAppletIframeScript: () => ipcRenderer.invoke('get-applet-iframe-script'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),
  getConductorInfo: () => ipcRenderer.invoke('get-conductor-info'),
  installAppletBundle: (
    appId: string,
    networkSeed: string,
    membraneProofs: any,
    agentPubKey: AgentPubKeyB64,
    happOrWebHappUrl: string,
    distributionInfo: DistributionInfo,
    sha256Happ: string,
    sha256Ui?: string,
    sha256Webhapp?: string,
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
      sha256Happ,
      sha256Ui,
      sha256Webhapp,
      metadata,
    ),
  isDevModeEnabled: () => ipcRenderer.invoke('is-dev-mode-enabled'),
  joinGroup: (networkSeed: string) => ipcRenderer.invoke('join-group', networkSeed),
  enableDevMode: () => ipcRenderer.invoke('enable-dev-mode'),
  disableDevMode: () => ipcRenderer.invoke('disable-dev-mode'),
  fetchIcon: (appActionHashB64: ActionHashB64) =>
    ipcRenderer.invoke('fetch-icon', appActionHashB64),
  selectScreenOrWindow: () => ipcRenderer.invoke('select-screen-or-window'),
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
  validateHappOrWebhapp: (bytes: number[]) => ipcRenderer.invoke('validate-happ-or-webhapp', bytes),
});

declare global {
  interface Window {
    electronAPI: unknown;
  }
}

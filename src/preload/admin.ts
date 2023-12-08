// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { ActionHashB64, AgentPubKeyB64 } from '@holochain/client';
import { contextBridge, ipcRenderer } from 'electron';
import { ZomeCallUnsignedNapi } from 'hc-we-rust-utils';

contextBridge.exposeInMainWorld('electronAPI', {
  signZomeCall: (zomeCall: ZomeCallUnsignedNapi) => ipcRenderer.invoke('sign-zome-call', zomeCall),
  installApp: (filePath: string, appId: string, networkSeed?: string) =>
    ipcRenderer.invoke('install-app', filePath, appId, networkSeed),
  // uninstallApp: (appId: string) => ipcRenderer.invoke('uninstall-app', appId),
  openApp: (appId: string) => ipcRenderer.invoke('open-app', appId),
  openAppStore: () => ipcRenderer.invoke('open-appstore'),
  openDevHub: () => ipcRenderer.invoke('open-devhub'),
  getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),
  getConductorInfo: () => ipcRenderer.invoke('get-conductor-info'),
  installAppletBundle: (
    appId: string,
    networkSeed: string,
    membraneProofs: any,
    agentPubKey: AgentPubKeyB64,
    webHappUrl: string,
  ) =>
    ipcRenderer.invoke(
      'install-applet-bundle',
      appId,
      networkSeed,
      membraneProofs,
      agentPubKey,
      webHappUrl,
    ),
  isDevModeEnabled: () => ipcRenderer.invoke('is-dev-mode-enabled'),
  joinGroup: (networkSeed: string) => ipcRenderer.invoke('join-group', networkSeed),
  enableDevMode: () => ipcRenderer.invoke('enable-dev-mode'),
  disableDevMode: () => ipcRenderer.invoke('disable-dev-mode'),
  fetchIcon: (appActionHashB64: ActionHashB64) =>
    ipcRenderer.invoke('fetch-icon', appActionHashB64),
});

declare global {
  interface Window {
    electronAPI: unknown;
  }
}

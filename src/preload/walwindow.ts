// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
// IPC_CHANGE_HERE
import { CallZomeRequest } from '@holochain/client';
import { contextBridge, ipcRenderer } from 'electron';
import { AppletId, AppletToParentMessage, ParentToAppletMessage } from '@theweave/api';
import { AudioSourcePickerRequest, AudioSourcePortDelivery } from '@theweave/moss-types';

contextBridge.exposeInMainWorld('electronAPI', {
  appletMessageToParent: (message: AppletToParentMessage) =>
    ipcRenderer.invoke('applet-message-to-parent', message),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  focusMainWindow: () => ipcRenderer.invoke('focus-main-window'),
  focusMyWindow: () => ipcRenderer.invoke('focus-my-window'),
  getMySrc: () => ipcRenderer.invoke('get-my-src'),
  isAppletDev: () => ipcRenderer.invoke('is-applet-dev'),
  onWindowClosing: (callback: (e: Electron.IpcRendererEvent) => any) =>
    ipcRenderer.on('window-closing', callback),
  onParentToAppletMessage: (
    callback: (
      e: Electron.IpcRendererEvent,
      message: ParentToAppletMessage,
      forApplets: AppletId[],
    ) => any,
  ) => ipcRenderer.on('parent-to-applet-message', callback),
  onWillNavigateExternal: (callback: (e: Electron.IpcRendererEvent) => any) =>
    ipcRenderer.on('will-navigate-external', callback),
  onRequestIframeStoreSync: (callback: (e: Electron.IpcRendererEvent) => any) =>
    ipcRenderer.on('request-iframe-store-sync', callback),
  iframeStoreSync: (storeContent) => ipcRenderer.invoke('iframe-store-sync', storeContent),
  removeWillNavigateListeners: () => ipcRenderer.removeAllListeners('will-navigate-external'),
  selectScreenOrWindow: () => ipcRenderer.invoke('select-screen-or-window'),
  requestAudioSources: (req: { requestId: string; toolName: string }) =>
    ipcRenderer.invoke('request-audio-sources', req),
  stopAudioSources: (grantId: string, reason: 'user-stopped' | 'iframe-unloaded') =>
    ipcRenderer.invoke('stop-audio-sources', grantId, reason),
  onShowAudioSourcePicker: (
    callback: (e: Electron.IpcRendererEvent, request: AudioSourcePickerRequest) => any,
  ) => ipcRenderer.on('show-audio-source-picker', callback),
  audioSourcesSelected: (pickerId: string, ids: string[] | null) =>
    ipcRenderer.invoke('audio-sources-selected', pickerId, ids),
  setMyIcon: (icon: string) => ipcRenderer.invoke('set-my-icon', icon),
  setMyTitle: (title: string) => ipcRenderer.invoke('set-my-title', title),
  signZomeCallApplet: (request: CallZomeRequest, callerAppletIds: string[]) =>
    ipcRenderer.invoke('sign-zome-call-applet', request, callerAppletIds),
});

declare global {
  interface Window {
    electronAPI: unknown;
  }
}

// A grant's MessagePort arrives from main on this channel; it cannot be
// proxied through the context bridge, so it is re-posted into the page where
// the applet host forwards it to the requesting Tool.
ipcRenderer.on('audio-source-port', (event, payload: AudioSourcePortDelivery) => {
  window.postMessage({ type: 'audio-source-port', ...payload }, '*', event.ports);
});

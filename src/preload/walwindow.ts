// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
// IPC_CHANGE_HERE
import { CallZomeRequest } from '@holochain/client';
import { contextBridge, ipcRenderer } from 'electron';
import { AppletToParentMessage } from '@theweave/api';

contextBridge.exposeInMainWorld('electronAPI', {
  appletMessageToParent: (message: AppletToParentMessage) =>
    ipcRenderer.invoke('applet-message-to-parent', message),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  focusMainWindow: () => ipcRenderer.invoke('focus-main-window'),
  focusMyWindow: () => ipcRenderer.invoke('focus-my-window'),
  getMySrc: () => ipcRenderer.invoke('get-my-src'),
  onWindowClosing: (callback: (e: Electron.IpcRendererEvent) => any) =>
    ipcRenderer.on('window-closing', callback),
  selectScreenOrWindow: () => ipcRenderer.invoke('select-screen-or-window'),
  setMyIcon: (icon: string) => ipcRenderer.invoke('set-my-icon', icon),
  setMyTitle: (title: string) => ipcRenderer.invoke('set-my-title', title),
  signZomeCallApplet: (request: CallZomeRequest) =>
    ipcRenderer.invoke('sign-zome-call-applet', request),
});

declare global {
  interface Window {
    electronAPI: unknown;
  }
}

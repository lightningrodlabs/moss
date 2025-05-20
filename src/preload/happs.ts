// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { CallZomeRequest } from '@holochain/client';
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  signZomeCall: (zomeCall: CallZomeRequest) => ipcRenderer.invoke('sign-zome-call', zomeCall),
});

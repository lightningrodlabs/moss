// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron'
import { ZomeCallUnsignedNapi } from 'hc-launcher-rust-utils'

contextBridge.exposeInMainWorld('electronAPI', {
  signZomeCall: (zomeCall: ZomeCallUnsignedNapi) =>
    ipcRenderer.invoke('sign-zome-call', zomeCall),
});

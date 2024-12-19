// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { PasswordType } from '@theweave/moss-types';
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  onProgressUpdate: (callback) => ipcRenderer.on('loading-progress-update', callback),
  lairSetupRequired: () => ipcRenderer.invoke('lair-setup-required'),
  launch: (passwordType: PasswordType) => ipcRenderer.invoke('launch', passwordType),
  getProfile: () => ipcRenderer.invoke('get-profile'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  factoryReset: () => ipcRenderer.invoke('factory-reset'),
  exit: () => ipcRenderer.invoke('exit'),
});

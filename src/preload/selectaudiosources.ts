// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getAudioSourceRows: () => ipcRenderer.invoke('get-audio-source-rows'),
  audioSourcesSelected: (ids: string[] | null) => ipcRenderer.invoke('audio-sources-selected', ids),
});

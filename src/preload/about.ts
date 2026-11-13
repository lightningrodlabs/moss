// Preload for the About window (src/main/aboutWindow.ts).
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  aboutInfo: () => ipcRenderer.invoke('about-info'),
  openChromiumNotices: () => ipcRenderer.invoke('about-open-chromium-notices'),
});

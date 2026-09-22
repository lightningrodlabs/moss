import { ipcMain } from 'electron';
import type { AudioCapabilities } from '@theweave/moss-types';
import { AudioSourceGrants } from './audioSourceGrants';
import { pickerRows, pickerSelected } from './audioSourcePicker';

/**
 * The renderer↔main surface of the audio-source feature. Channel names are
 * string literals here and in the preloads so `ipc-contract-drift.test.ts` can
 * pair them. A window that ever requested a grant has its grants ended when its
 * webContents is destroyed (WAL window closed, main window reloaded).
 */
export function registerAudioSourceIpc(
  grants: AudioSourceGrants,
  capabilities: () => Promise<AudioCapabilities>,
): void {
  const watched = new Set<number>();

  ipcMain.handle(
    'request-audio-sources',
    async (event, req: { requestId: string; toolName: string }) => {
      const sender = event.sender;
      const targetId = sender.id;
      if (!watched.has(targetId)) {
        watched.add(targetId);
        sender.once('destroyed', () => {
          watched.delete(targetId);
          void grants.endGrantsForTarget(targetId, 'window-closed');
        });
      }
      return grants.request({ requestId: req.requestId, toolName: req.toolName, targetId });
    },
  );
  ipcMain.handle(
    'stop-audio-sources',
    (_e, grantId: string, reason: 'user-stopped' | 'iframe-unloaded') =>
      grants.endGrant(grantId, reason),
  );
  ipcMain.handle('list-audio-source-grants', () => grants.list());
  ipcMain.handle('get-audio-capabilities', () => capabilities());
  ipcMain.handle('get-audio-source-rows', () => pickerRows());
  ipcMain.handle('audio-sources-selected', (_e, ids: string[] | null) => pickerSelected(ids));
}

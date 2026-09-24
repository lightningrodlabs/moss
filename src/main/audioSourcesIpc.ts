import { BrowserWindow, ipcMain, webContents } from 'electron';
import type { Event, WebContents, WebContentsDidStartNavigationEventParams } from 'electron';
import type { AudioCapabilities } from '@theweave/moss-types';
import { AudioSourceGrants } from './audioSourceGrants';
import { InWindowAudioSourcePicker, type PickerWindow } from './audioSourcePicker';

/**
 * A renderer window as the picker needs it. Its page counts as gone when it is
 * destroyed, crashes, or navigates away, because a dialog shown to the old
 * page can no longer be answered.
 */
export function pickerWindowFor(targetId: number): PickerWindow | undefined {
  const wc = webContents.fromId(targetId);
  if (!wc) return undefined;
  return {
    isDestroyed: () => wc.isDestroyed(),
    showPicker: (request) => wc.send('show-audio-source-picker', request),
    focus: () => {
      const window = BrowserWindow.fromWebContents(wc);
      if (!window) return;
      if (window.isMinimized()) window.restore();
      window.focus();
    },
    onGone: (listener) => {
      const onNavigated = (details: Event<WebContentsDidStartNavigationEventParams>): void => {
        if (details.isMainFrame && !details.isSameDocument) listener();
      };
      wc.on('did-start-navigation', onNavigated);
      wc.on('render-process-gone', listener);
      wc.on('destroyed', listener);
      return () => {
        if (wc.isDestroyed()) return;
        wc.off('did-start-navigation', onNavigated);
        wc.off('render-process-gone', listener);
        wc.off('destroyed', listener);
      };
    },
  };
}

/**
 * The renderer↔main surface of the audio-source feature. Channel names are
 * string literals here and in the preloads so `ipc-contract-drift.test.ts` can
 * pair them. A window that ever requested a grant has its grants ended when
 * its owning page is gone in any of the ways a page can be gone: the window
 * closed, the page navigated or reloaded (`WebContents` survives a reload —
 * same object, same id — so `destroyed` alone misses this), or the renderer
 * crashed.
 */
export function registerAudioSourceIpc(
  grants: AudioSourceGrants,
  picker: InWindowAudioSourcePicker,
  capabilities: () => Promise<AudioCapabilities>,
): void {
  const watched = new Set<number>();

  /**
   * Ends a sender's grants the first time its page is gone, by whichever of
   * the three routes gets there first, and stops watching once one does.
   */
  function watchSenderForGrantTeardown(sender: WebContents, grants: AudioSourceGrants): void {
    const targetId = sender.id;
    if (watched.has(targetId)) return;
    watched.add(targetId);

    const end = (): void => {
      void grants.endGrantsForTarget(targetId, 'window-closed');
    };
    const onNavigated = (details: Event<WebContentsDidStartNavigationEventParams>): void => {
      if (details.isMainFrame && !details.isSameDocument) end();
    };
    const onRenderProcessGone = (): void => end();
    const onDestroyed = (): void => {
      watched.delete(targetId);
      sender.off('did-start-navigation', onNavigated);
      sender.off('render-process-gone', onRenderProcessGone);
      end();
    };

    sender.on('did-start-navigation', onNavigated);
    sender.on('render-process-gone', onRenderProcessGone);
    sender.once('destroyed', onDestroyed);
  }

  ipcMain.handle(
    'request-audio-sources',
    async (event, req: { requestId: string; toolName: string }) => {
      const sender = event.sender;
      watchSenderForGrantTeardown(sender, grants);
      return grants.request({
        requestId: req.requestId,
        toolName: req.toolName,
        targetId: sender.id,
      });
    },
  );
  ipcMain.handle(
    'stop-audio-sources',
    (_e, grantId: string, reason: 'user-stopped' | 'iframe-unloaded') =>
      grants.endGrant(grantId, reason),
  );
  ipcMain.handle('list-audio-source-grants', () => grants.list());
  ipcMain.handle('get-audio-capabilities', () => capabilities());
  ipcMain.handle('audio-sources-selected', (event, pickerId: string, ids: string[] | null) =>
    picker.answer(event.sender.id, pickerId, ids),
  );
}

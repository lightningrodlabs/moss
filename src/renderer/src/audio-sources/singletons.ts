import { nanoid } from 'nanoid';
import { PersistedStore } from '../persisted-store.js';
import { AudioSourceGrantsClient } from './grants-client.js';
import { AudioSourcePortReceiver } from './port-receiver.js';
import './audio-source-picker-dialog.js';
import type { AudioSourcePickerDialog } from './audio-source-picker-dialog.js';

/**
 * One receiver and one client per window (the main window and each WAL
 * window run this module separately). The receiver is installed on `window`
 * at first import so a port delivery can never precede the listener.
 */
export const audioSourcePortReceiver = new AudioSourcePortReceiver(window, (grantId) => {
  void window.electronAPI.stopAudioSources(grantId, 'iframe-unloaded');
});
audioSourcePortReceiver.install(window);

export const audioSourceGrantsClient = new AudioSourceGrantsClient({
  isEnabled: () => new PersistedStore().audioSourcesEnabled.value(),
  newRequestId: () => nanoid(8),
  requestAudioSources: (req) => window.electronAPI.requestAudioSources(req),
  stopAudioSources: (grantId, reason) => window.electronAPI.stopAudioSources(grantId, reason),
  expectPort: (requestId) => audioSourcePortReceiver.expect(requestId),
  armPortDeadline: (requestId) => audioSourcePortReceiver.armDeadline(requestId),
  cancelPortExpectation: (requestId) => audioSourcePortReceiver.cancel(requestId),
});

/**
 * Releases an unloading iframe's grants without making the caller wait on
 * main: an unregister must complete even when the stop fails, or the window
 * keeps an iframe entry for a frame that is gone.
 */
export function releaseGrantsFor(iframeId: string): void {
  void audioSourceGrantsClient
    .endForIframe(iframeId)
    .catch((e) =>
      console.warn('[audio-sources] releasing grants for an unloading iframe failed', e),
    );
}

/**
 * Main shows the audio-source picker in the window whose Tool asked, so this
 * window hosts its own picker dialog, created on first use.
 */
let pickerDialog: AudioSourcePickerDialog | undefined;
window.electronAPI.onShowAudioSourcePicker((_e, request) => {
  if (!pickerDialog) {
    pickerDialog = document.createElement('audio-source-picker-dialog') as AudioSourcePickerDialog;
    document.body.appendChild(pickerDialog);
  }
  void pickerDialog.show(request, (pickerId, ids) => {
    void window.electronAPI.audioSourcesSelected(pickerId, ids);
  });
});

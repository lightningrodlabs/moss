import { nanoid } from 'nanoid';
import { PersistedStore } from '../persisted-store.js';
import { AudioSourceGrantsClient } from './grants-client.js';
import { AudioSourcePortReceiver } from './port-receiver.js';

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
});

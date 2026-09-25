// The DictationHost for Moss's own UI: the ASR IPC from main, the
// renderer's microphone, and the bridge that routes session events.

import { getAsrRendererBridge } from '../applets/asr-bridge.js';
import type { DictationHost } from './dictation.js';
import { openMicCapture } from './mic-capture.js';

export function mossDictationHost(): DictationHost {
  return {
    warmUp: () => window.electronAPI.asrWarmUp(),
    openMic: openMicCapture,
    openSession: (opts) => window.electronAPI.asrOpenSession(opts),
    pushAudio: (req) => window.electronAPI.asrPushAudio(req),
    closeSession: (req) => window.electronAPI.asrCloseSession(req),
    registerListener: (sessionId, listener) =>
      getAsrRendererBridge().registerLocalSession(sessionId, listener),
    unregister: (sessionId) => getAsrRendererBridge().unregisterSession(sessionId),
  };
}

/** True when the Transcription switch is on and the host has a model. */
export async function mossDictationAvailable(localAiEnabled: boolean): Promise<boolean> {
  if (!localAiEnabled) return false;
  try {
    const caps = await window.electronAPI.asrCapabilities();
    return caps.asr.available;
  } catch {
    return false;
  }
}

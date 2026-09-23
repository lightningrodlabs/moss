/**
 * Types shared by the main process, the preloads and the renderer for the
 * audio-source capture feature: a Tool asks Moss for audio that is playing on
 * this machine, the user picks the sources, and the Tool receives a
 * MessagePort of PCM frames until the grant ends.
 */

export type AudioBackendName = 'pipewire' | 'coreaudio' | 'wasapi' | 'none';

export interface AudioCapabilities {
  /** The native addon loaded and its device probe answered. */
  supported: boolean;
  /** Per-application sources can be enumerated and captured. */
  perApp: boolean;
  /** The backend can exclude Moss's own playback from the capture. */
  canExcludeSelf: boolean;
  backend: AudioBackendName;
  /** Set when `supported` or `perApp` is false: the probe outcome that made it so. */
  reason?: string;
}

export interface AudioSourceRow {
  /** Opaque id valid for one picker; `'system'` for the all-output row. Never a pid. */
  id: string;
  kind: 'system' | 'app';
  name: string;
  /** true = playing now, false = silent, null = the OS does not say. */
  playing: boolean | null;
}

export interface AudioSourceRequestResult {
  grantId: string;
  /** Human-readable summary of the chosen sources, e.g. "System audio" or "Spotify, Firefox". */
  label: string;
  canExcludeSelf: boolean;
}

export type AudioSourceEndReason =
  | 'user-stopped'
  | 'tool-closed'
  | 'iframe-unloaded'
  | 'window-closed'
  | 'stream-lost'
  | 'permission-denied'
  | 'stream-error'
  | 'app-quit';

export interface AudioSourceGrantCounters {
  /** Chunks the backend reported dropping (`chunkDropped` events). */
  chunksDropped: number;
  /** Chunks the mixer discarded because a stream's queue exceeded its backlog cap. */
  backlogDropped: number;
  stalls: number;
  recoveries: number;
  framesSent: number;
}

export interface AudioSourceGrantInfo {
  grantId: string;
  toolName: string;
  label: string;
  canExcludeSelf: boolean;
  /** Wall-clock ms at grant start. */
  startedAt: number;
  counters: AudioSourceGrantCounters;
}

/** Control messages on the grant port. Main sends `ended` before closing; the Tool sends `close`. */
export type AudioSourcePortControl =
  | { type: 'ended'; reason: AudioSourceEndReason }
  | { type: 'close' };

/** Payload of the `audio-source-port` IPC message (the port rides in `ports[0]`). */
export interface AudioSourcePortDelivery {
  requestId: string;
  grantId: string;
}

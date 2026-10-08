// Shapes that cross the main ↔ preload ↔ renderer boundary for the speech
// model list under Settings > Services > Transcription.

export type AsrLatencyTier = 'fast' | 'ok' | 'slow';

/** One row of the model list: a catalog entry plus its state on this install. */
export interface AsrModelListEntry {
  /** Short name as whisper.cpp uses it, e.g. 'base.en'. */
  id: string;
  sizeBytes: number;
  /** ISO 639-1 codes the model transcribes. */
  languages: readonly string[];
  latencyTier: AsrLatencyTier;
  /** A complete copy exists, downloaded or bundled. */
  installed: boolean;
  /** Shipped with the installer; cannot be deleted. */
  bundled: boolean;
  /** This is the model the sidecar loads. */
  active: boolean;
  /** Size of a leftover partial download, when one exists. */
  partialBytes?: number;
}

export interface AsrModelDownloadProgress {
  id: string;
  bytes: number;
  total: number;
}

/** Announced to every window when a download settles, however it ended. */
export interface AsrModelDownloadEnded {
  id: string;
  outcome: 'complete' | 'cancelled' | 'error';
  error?: string;
}

// Pure presentation logic for one row of the speech-model list, kept out
// of the Lit element so it can be unit-tested without a DOM.

import type { AsrModelDownloadProgress, AsrModelListEntry } from '@theweave/moss-types';

export type ModelRowState =
  | { kind: 'download' }
  | { kind: 'resume'; partialBytes: number; deletable: true }
  | { kind: 'downloading'; percent: number }
  | { kind: 'installed'; deletable: boolean }
  | { kind: 'active'; deletable: boolean };

export function modelRowState(
  entry: AsrModelListEntry,
  progress: AsrModelDownloadProgress | undefined,
): ModelRowState {
  if (progress) {
    const percent = progress.total > 0 ? Math.floor((100 * progress.bytes) / progress.total) : 0;
    return { kind: 'downloading', percent };
  }
  if (entry.installed) {
    // The bundled copy is read-only; only a downloaded model can be removed.
    const deletable = !entry.bundled;
    return entry.active ? { kind: 'active', deletable } : { kind: 'installed', deletable };
  }
  if (entry.partialBytes !== undefined) return { kind: 'resume', partialBytes: entry.partialBytes, deletable: true };
  return { kind: 'download' };
}

export function formatModelSize(bytes: number): string {
  const GB = 1_000_000_000;
  const MB = 1_000_000;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  return `${Math.round(bytes / MB)} MB`;
}

export function isEnglishOnly(languages: readonly string[]): boolean {
  return languages.length === 1 && languages[0] === 'en';
}

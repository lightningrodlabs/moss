import type { AudioSourcePickerRequest, AudioSourceRow } from '@theweave/moss-types';
import type { PickerRequester } from './audioSourceGrants';

/** The requesting window, as the picker sees it (structurally a `WebContents` wrapper). */
export interface PickerWindow {
  isDestroyed(): boolean;
  showPicker(request: AudioSourcePickerRequest): void;
  focus(): void;
  /** Calls `listener` once the window's page is gone; returns an unsubscribe. */
  onGone(listener: () => void): () => void;
}

export interface InWindowAudioSourcePickerDeps {
  lookup: (targetId: number) => PickerWindow | undefined;
  newId: () => string;
}

interface Pending {
  pickerId: string;
  targetId: number;
  offered: Set<string>;
  settle: (ids: string[] | null) => void;
}

/**
 * Shows the audio-source picker as a dialog inside the window that asked for
 * audio, so it appears over the Tool that asked rather than in a window the
 * user may not be looking at. Only that window can answer, and only with ids
 * it was offered.
 */
export class InWindowAudioSourcePicker {
  private pending: Pending | null = null;

  constructor(private readonly deps: InWindowAudioSourcePickerDeps) {}

  open(rows: AudioSourceRow[], requester: PickerRequester): Promise<string[] | null> {
    const window = this.deps.lookup(requester.targetId);
    if (!window || window.isDestroyed()) return Promise.resolve(null);

    const pickerId = this.deps.newId();
    return new Promise((resolve) => {
      const stopWatching = window.onGone(() => settle(null));
      const settle = (ids: string[] | null) => {
        if (this.pending?.pickerId !== pickerId) return;
        this.pending = null;
        stopWatching();
        resolve(ids);
      };
      this.pending = {
        pickerId,
        targetId: requester.targetId,
        offered: new Set(rows.map((r) => r.id)),
        settle,
      };
      window.showPicker({ pickerId, toolName: requester.toolName, rows });
      window.focus();
    });
  }

  /** The dialog in window `senderId` confirmed (`ids`) or cancelled (`null`). */
  answer(senderId: number, pickerId: string, ids: string[] | null): void {
    const p = this.pending;
    if (!p || p.pickerId !== pickerId || p.targetId !== senderId) return;
    p.settle(ids ? ids.filter((id) => p.offered.has(id)) : null);
  }
}

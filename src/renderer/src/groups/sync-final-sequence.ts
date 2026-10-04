/** How long the synced message stays up before the screen morphs into the group home. */
export const SYNCED_HOLD_MS = 2500;
/** Duration of the morph of the stage icon onto the group header icon. */
export const MORPH_MS = 600;

export interface FinalTimeline {
  morphAt: number;
  doneAt: number;
}

/**
 * When the closing steps of the waiting screen happen. It depends only on the
 * moment the synced message was shown, because metrics stop arriving once the
 * group profile is known.
 */
export function finalTimeline(syncedAt: number): FinalTimeline {
  const morphAt = syncedAt + SYNCED_HOLD_MS;
  return { morphAt, doneAt: morphAt + MORPH_MS };
}

/** Timers owned by one element, so all of them can be dropped when it is removed. */
export class TimerBag {
  private timers = new Set<ReturnType<typeof setTimeout>>();

  get size(): number {
    return this.timers.size;
  }

  /** Schedules `fn` and returns a function that cancels it. */
  set(fn: () => void, delayMs: number): () => void {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, delayMs);
    this.timers.add(id);
    return () => {
      clearTimeout(id);
      this.timers.delete(id);
    };
  }

  clear(): void {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
  }
}

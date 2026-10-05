import type { SyncStage } from './sync-progress.js';

/** What the waiting screen shows: a sync stage, or `synced` once the group profile arrived. */
export type DisplayStage = SyncStage | 'synced';

export interface GateState {
  shown: DisplayStage;
  shownAt: number;
  pending: DisplayStage | undefined;
}

/** A stage stays visible this long so a fast conductor cannot flash three headings in a row. */
export const MIN_STAGE_DWELL_MS = 700;

/** Returns the next state and, when a change must wait, the delay in ms until it may be shown. */
export function gateStage(
  state: GateState,
  wanted: DisplayStage,
  now: number,
): { state: GateState; delayMs: number | undefined } {
  if (wanted === state.shown)
    return { state: { ...state, pending: undefined }, delayMs: undefined };
  const elapsed = now - state.shownAt;
  if (elapsed >= MIN_STAGE_DWELL_MS) {
    return { state: { shown: wanted, shownAt: now, pending: undefined }, delayMs: undefined };
  }
  return { state: { ...state, pending: wanted }, delayMs: MIN_STAGE_DWELL_MS - elapsed };
}

import type { AgentPubKey } from '@holochain/client';
import type { TimerBag } from './sync-final-sequence.js';

/** Agents per conductor call when a ping cycle is spread out. */
export const PING_BATCH_SIZE = 32;
/** Gap between batches when they all fit inside the cycle budget. */
export const PING_BATCH_SPACING_MS = 500;
/** Every batch of a cycle starts within this window, so the next 8-second cycle never drops one. */
export const PING_CYCLE_BUDGET_MS = 7000;

/**
 * Splits agents into consecutive batches, batch i sent at i * spacing, so a large group
 * does not reach the conductor all at once. The spacing shrinks when needed so the last batch
 * starts within PING_CYCLE_BUDGET_MS. Input order is preserved.
 */
export function planPingBatches<T>(
  agents: T[],
  opts: { batchSize?: number; spacingMs?: number } = {},
): Array<{ delayMs: number; agents: T[] }> {
  const batchSize = Math.max(1, opts.batchSize ?? PING_BATCH_SIZE);
  const nBatches = Math.ceil(agents.length / batchSize);
  const spacingMs = Math.min(
    opts.spacingMs ?? PING_BATCH_SPACING_MS,
    Math.floor(PING_CYCLE_BUDGET_MS / Math.max(1, nBatches - 1)),
  );
  const batches: Array<{ delayMs: number; agents: T[] }> = [];
  for (let i = 0; i * batchSize < agents.length; i++) {
    batches.push({
      delayMs: i * spacingMs,
      agents: agents.slice(i * batchSize, (i + 1) * batchSize),
    });
  }
  return batches;
}

/**
 * Spreads each ping cycle across its window. A new cycle replaces batches still pending from the
 * last one; extra sends (newly discovered agents) run alongside the cycle in progress.
 */
export class PacedPingSender {
  private stopped = false;

  constructor(
    private readonly send: (agents: AgentPubKey[]) => Promise<void>,
    private readonly timers: TimerBag,
  ) {}

  startCycle(agents: AgentPubKey[]): void {
    if (this.stopped) return;
    this.timers.clear();
    this.sendNow(agents);
  }

  sendNow(agents: AgentPubKey[]): void {
    if (this.stopped) return;
    for (const batch of planPingBatches(agents)) {
      const run = () => {
        this.send(batch.agents).catch((e) => console.warn('Peer status ping failed: ', e));
      };
      if (batch.delayMs === 0) run();
      else this.timers.set(run, batch.delayMs);
    }
  }

  /** Drops pending batches and ignores later sends, so nothing fires after the owner is gone. */
  stop(): void {
    this.stopped = true;
    this.timers.clear();
  }
}

/** A grant attempt is made only while none has succeeded and none is running. */
export function shouldAttemptGrant(done: boolean, inFlight: boolean): boolean {
  return !done && !inFlight;
}

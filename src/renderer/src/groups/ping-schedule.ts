import type { AgentPubKey } from '@holochain/client';
import type { TimerBag } from './sync-final-sequence.js';

/** Agents per conductor call when a ping cycle is spread out. */
export const PING_BATCH_SIZE = 32;
/** Gap between batches; 16 batches fill the 8-second cycle for 512 agents. */
export const PING_BATCH_SPACING_MS = 500;

/**
 * Splits agents into consecutive batches, batch i sent at i * spacingMs, so a large group
 * does not reach the conductor all at once. Input order is preserved.
 */
export function planPingBatches<T>(
  agents: T[],
  opts: { batchSize?: number; spacingMs?: number } = {},
): Array<{ delayMs: number; agents: T[] }> {
  const batchSize = Math.max(1, opts.batchSize ?? PING_BATCH_SIZE);
  const spacingMs = opts.spacingMs ?? PING_BATCH_SPACING_MS;
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

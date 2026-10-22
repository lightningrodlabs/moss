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
    batches.push({ delayMs: i * spacingMs, agents: agents.slice(i * batchSize, (i + 1) * batchSize) });
  }
  return batches;
}

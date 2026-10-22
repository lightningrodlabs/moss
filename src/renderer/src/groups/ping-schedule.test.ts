import { describe, expect, it } from 'vitest';
import { planPingBatches } from './ping-schedule';

describe('planPingBatches', () => {
  it('sends a small group as one immediate batch', () => {
    expect(planPingBatches(['a', 'b', 'c'])).toEqual([{ delayMs: 0, agents: ['a', 'b', 'c'] }]);
  });
  it('spreads a large group across spaced batches in order', () => {
    const agents = Array.from({ length: 100 }, (_, i) => `a${i}`);
    const plan = planPingBatches(agents, { batchSize: 32, spacingMs: 500 });
    expect(plan.map((b) => b.delayMs)).toEqual([0, 500, 1000, 1500]);
    expect(plan.map((b) => b.agents.length)).toEqual([32, 32, 32, 4]);
    expect(plan.flatMap((b) => b.agents)).toEqual(agents);
  });
  it('returns no batches for no agents', () => {
    expect(planPingBatches([])).toEqual([]);
  });
});

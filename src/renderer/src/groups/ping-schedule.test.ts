import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { AgentPubKey } from '@holochain/client';
import {
  PING_CYCLE_BUDGET_MS,
  PacedPingSender,
  planPingBatches,
  shouldAttemptGrant,
} from './ping-schedule';
import { TimerBag } from './sync-final-sequence';

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
  it('fits every batch of a very large group inside the cycle budget', () => {
    const agents = Array.from({ length: 600 }, (_, i) => `a${i}`);
    const plan = planPingBatches(agents);
    expect(PING_CYCLE_BUDGET_MS).toBe(7000);
    expect(plan).toHaveLength(19);
    expect(plan[plan.length - 1].delayMs).toBeLessThanOrEqual(7000);
    const sent = plan.flatMap((b) => b.agents);
    expect(sent).toHaveLength(600);
    expect(new Set(sent).size).toBe(600);
  });
  it('returns no batches for no agents', () => {
    expect(planPingBatches([])).toEqual([]);
  });
});

const agentList = (n: number, prefix = 0): AgentPubKey[] =>
  Array.from({ length: n }, (_, i) => new Uint8Array([prefix, i]));

describe('PacedPingSender', () => {
  let send: Mock<[AgentPubKey[]], Promise<void>>;
  let sender: PacedPingSender;
  beforeEach(() => {
    vi.useFakeTimers();
    send = vi.fn<[AgentPubKey[]], Promise<void>>(async () => {});
    sender = new PacedPingSender(send, new TimerBag());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends batch 0 at once and the rest at 500 ms steps', () => {
    sender.startCycle(agentList(100));
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls.map((c) => c[0].length)).toEqual([32, 32, 32, 4]);
  });

  it('cancels the pending batches of the previous cycle', () => {
    sender.startCycle(agentList(100));
    sender.startCycle(agentList(100, 1));
    vi.advanceTimersByTime(5000);
    expect(send).toHaveBeenCalledTimes(2 + 3);
  });

  it('sends nothing after stop', () => {
    sender.startCycle(agentList(100));
    sender.stop();
    send.mockClear();
    vi.advanceTimersByTime(5000);
    sender.sendNow(agentList(3));
    sender.startCycle(agentList(3));
    expect(send).not.toHaveBeenCalled();
  });

  it('sendNow does not cancel a cycle in progress', () => {
    sender.startCycle(agentList(100));
    sender.sendNow(agentList(2, 9));
    vi.advanceTimersByTime(5000);
    expect(send).toHaveBeenCalledTimes(4 + 1);
  });

  it('warns and keeps going when a send fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    send.mockRejectedValueOnce(new Error('boom'));
    sender.startCycle(agentList(40));
    await vi.advanceTimersByTimeAsync(500);
    expect(send).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('shouldAttemptGrant', () => {
  it('attempts only when not done and nothing in flight', () => {
    expect(shouldAttemptGrant(false, false)).toBe(true);
    expect(shouldAttemptGrant(true, false)).toBe(false);
    expect(shouldAttemptGrant(false, true)).toBe(false);
    expect(shouldAttemptGrant(true, true)).toBe(false);
  });
});

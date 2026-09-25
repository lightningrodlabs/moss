import { describe, it, expect } from 'vitest';
import { formatGrantSummary } from './grant-summary';
import type { AudioSourceGrantInfo } from '@theweave/moss-types';

const grant = (startedAt: number): AudioSourceGrantInfo => ({
  grantId: 'g1',
  toolName: 'Presence',
  label: 'System audio',
  canExcludeSelf: true,
  startedAt,
  counters: { chunksDropped: 0, backlogDropped: 0, stalls: 0, recoveries: 0, framesSent: 0 },
});

describe('formatGrantSummary', () => {
  it.each([
    [0, '0:00'],
    [59_000, '0:59'],
    [61_000, '1:01'],
    [3_600_000, '60:00'],
  ])('elapsed %d ms → %s', (elapsed, expected) => {
    expect(formatGrantSummary(grant(10_000), 10_000 + elapsed).elapsed).toBe(expected);
  });

  it('never shows a negative elapsed time when clocks disagree', () => {
    expect(formatGrantSummary(grant(20_000), 10_000).elapsed).toBe('0:00');
  });

  it('title is "<tool>: <label>"', () => {
    expect(formatGrantSummary(grant(0), 0).title).toBe('Presence: System audio');
  });
});

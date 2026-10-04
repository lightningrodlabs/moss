import { describe, expect, it } from 'vitest';
import { gateStage, MIN_STAGE_DWELL_MS, type GateState } from './stage-gate.js';

const start: GateState = { shown: 'no-peers', shownAt: 1000, pending: undefined };

describe('gateStage', () => {
  it('shows a change immediately once the dwell has passed', () => {
    const r = gateStage(start, 'found', 1000 + MIN_STAGE_DWELL_MS);
    expect(r.state).toEqual({ shown: 'found', shownAt: 1700, pending: undefined });
    expect(r.delayMs).toBeUndefined();
  });
  it('holds a change that arrives inside the dwell and reports the remaining delay', () => {
    const r = gateStage(start, 'found', 1300);
    expect(r.state).toEqual({ shown: 'no-peers', shownAt: 1000, pending: 'found' });
    expect(r.delayMs).toBe(400);
  });
  it('keeps only the latest pending stage', () => {
    const a = gateStage(start, 'found', 1200).state;
    const b = gateStage(a, 'synced', 1300);
    expect(b.state.pending).toBe('synced');
    expect(b.delayMs).toBe(400);
  });
  it('drops a pending change when the derived stage returns to the shown one', () => {
    const a = gateStage(start, 'found', 1200).state;
    const b = gateStage(a, 'no-peers', 1250);
    expect(b.state).toEqual({ shown: 'no-peers', shownAt: 1000, pending: undefined });
    expect(b.delayMs).toBeUndefined();
  });
  it('jumps from no-peers straight to synced without synthesizing stages', () => {
    const r = gateStage(start, 'synced', 2000);
    expect(r.state.shown).toBe('synced');
  });
  it('holds synced behind the dwell when the profile arrives while still searching', () => {
    const held = gateStage(start, 'synced', 1100);
    expect(held.state.shown).toBe('no-peers');
    expect(held.delayMs).toBe(600);
    const shown = gateStage(held.state, 'synced', 1700);
    expect(shown.state).toEqual({ shown: 'synced', shownAt: 1700, pending: undefined });
  });
});

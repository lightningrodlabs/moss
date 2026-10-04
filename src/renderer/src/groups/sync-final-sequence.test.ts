import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finalTimeline, MORPH_MS, SYNCED_HOLD_MS, TimerBag } from './sync-final-sequence.js';

describe('finalTimeline', () => {
  it('depends only on when the synced message was first shown', () => {
    expect(finalTimeline(10_000)).toEqual({
      morphAt: 10_000 + SYNCED_HOLD_MS,
      doneAt: 10_000 + SYNCED_HOLD_MS + MORPH_MS,
    });
  });
  it('holds for 2.5 s and morphs for 600 ms', () => {
    expect(finalTimeline(0)).toEqual({ morphAt: 2500, doneAt: 3100 });
  });
});

describe('TimerBag', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a timer after its delay and forgets it', () => {
    const bag = new TimerBag();
    const fn = vi.fn();
    bag.set(fn, 100);
    expect(bag.size).toBe(1);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledOnce();
    expect(bag.size).toBe(0);
  });
  it('clears every pending timer so none fires on a detached element', () => {
    const bag = new TimerBag();
    const fns = [vi.fn(), vi.fn(), vi.fn()];
    bag.set(fns[0], 700);
    bag.set(fns[1], 2500);
    bag.set(fns[2], 3100);
    bag.clear();
    vi.advanceTimersByTime(10_000);
    for (const fn of fns) expect(fn).not.toHaveBeenCalled();
    expect(bag.size).toBe(0);
  });
  it('cancels one timer without touching the others', () => {
    const bag = new TimerBag();
    const a = vi.fn();
    const b = vi.fn();
    const cancelA = bag.set(a, 100);
    bag.set(b, 100);
    cancelA();
    vi.advanceTimersByTime(100);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });
});

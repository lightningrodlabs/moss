import { describe, expect, it } from 'vitest';
import {
  MAX_RADAR_DOTS,
  RADAR_DOT_RADIUS,
  RADAR_DOTS,
  radarDotStates,
  sweepFraction,
} from './sync-radar-icon.js';

describe('RADAR_DOTS', () => {
  it('has one place per dot the radar can show', () => {
    expect(RADAR_DOTS).toHaveLength(MAX_RADAR_DOTS);
  });

  it('keeps every dot inside the outer ring', () => {
    for (const [x, y] of RADAR_DOTS) {
      expect(Math.hypot(x - 12, y - 12) + RADAR_DOT_RADIUS).toBeLessThanOrEqual(10);
    }
  });

  it('never overlaps two dots', () => {
    RADAR_DOTS.forEach(([ax, ay], i) => {
      RADAR_DOTS.slice(i + 1).forEach(([bx, by]) => {
        expect(Math.hypot(ax - bx, ay - by)).toBeGreaterThan(2 * RADAR_DOT_RADIUS);
      });
    });
  });
});

describe('sweepFraction', () => {
  it('measures clockwise from 12 o’clock as a fraction of a turn', () => {
    expect(sweepFraction([12, 4])).toBeCloseTo(0);
    expect(sweepFraction([20, 12])).toBeCloseTo(0.25);
    expect(sweepFraction([12, 20])).toBeCloseTo(0.5);
    expect(sweepFraction([4, 12])).toBeCloseTo(0.75);
  });
});

describe('radarDotStates', () => {
  it('hides every dot while no peer is found', () => {
    expect(radarDotStates(0, 0)).toEqual(Array(MAX_RADAR_DOTS).fill('hidden'));
  });

  it('shows one dot per peer found, the failed ones first', () => {
    expect(radarDotStates(3, 1).slice(0, 4)).toEqual(['failed', 'found', 'found', 'hidden']);
  });

  it('stops at the number of dots the radar can show', () => {
    const states = radarDotStates(25, 2);
    expect(states).toHaveLength(MAX_RADAR_DOTS);
    expect(states.filter((s) => s === 'hidden')).toHaveLength(0);
    expect(states.filter((s) => s === 'failed')).toHaveLength(2);
  });

  it('never marks more dots failed than are shown', () => {
    expect(radarDotStates(2, 5).filter((s) => s === 'failed')).toHaveLength(2);
  });
});

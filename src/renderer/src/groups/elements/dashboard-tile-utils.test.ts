import { describe, it, expect } from 'vitest';
import {
  canFillHeight,
  nextTileColor,
  tileColorStyle,
  TILE_COLOR_CYCLE,
} from './dashboard-tile-utils';

const tile = (id: string, x: number, y: number, w: number, h: number) => ({
  id,
  layout: { x, y, w, h },
  tile: { kind: 'markdown' as const, source: '' },
});

describe('canFillHeight', () => {
  it('allows a lone tile', () => {
    const a = tile('a', 0, 0, 6, 3);
    expect(canFillHeight(a, [a])).toBe(true);
  });
  it('forbids when another tile extends below within the column span', () => {
    const a = tile('a', 0, 0, 6, 3); // bottom at y=3, cols 0..6
    const below = tile('b', 3, 4, 4, 2); // overlaps cols 3..6, bottom 6 > 3
    expect(canFillHeight(a, [a, below])).toBe(false);
  });
  it('allows when the other tile is in a non-overlapping column span', () => {
    const a = tile('a', 0, 0, 4, 3); // cols 0..4
    const beside = tile('b', 6, 4, 4, 2); // cols 6..10, no x-overlap
    expect(canFillHeight(a, [a, beside])).toBe(true);
  });
  it('allows when the other tile is above (does not extend below)', () => {
    const a = tile('a', 0, 4, 6, 3); // bottom 7
    const above = tile('b', 0, 0, 6, 3); // bottom 3 < 7
    expect(canFillHeight(a, [a, above])).toBe(true);
  });
});

describe('nextTileColor', () => {
  it('cycles through the full ring and wraps', () => {
    let color = TILE_COLOR_CYCLE[0];
    for (let i = 1; i < TILE_COLOR_CYCLE.length; i++) {
      color = nextTileColor(color);
      expect(color).toBe(TILE_COLOR_CYCLE[i]);
    }
    expect(nextTileColor(color)).toBe(TILE_COLOR_CYCLE[0]);
  });
  it('treats an unknown color as not-in-cycle and returns the second entry', () => {
    // indexOf returns -1, (-1 + 1) % len = 0 → first entry
    expect(nextTileColor('not-a-color')).toBe(TILE_COLOR_CYCLE[0]);
  });
});

describe('tileColorStyle', () => {
  it('returns empty for the default (undefined) color', () => {
    expect(tileColorStyle(undefined)).toBe('');
  });
  it('drops background and border for transparent', () => {
    expect(tileColorStyle('transparent')).toBe(
      'background: transparent; border-color: transparent;',
    );
  });
  it('sets a background for a named color', () => {
    expect(tileColorStyle('green')).toBe('background: #e3efd4;');
  });
  it('returns empty for an unknown color key', () => {
    expect(tileColorStyle('chartreuse')).toBe('');
  });
});

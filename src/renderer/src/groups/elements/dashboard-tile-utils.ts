import { msg } from '@lit/localize';
import { DashboardTile, DashboardTileEntry } from '@theweave/group-client';

/**
 * Draft state for the add/edit-tile dialog. WAL tiles intentionally aren't
 * here: they flow through the standard asset picker (userSelectWal) and never
 * use the dialog.
 */
export type NewTileDraft =
  | { kind: 'markdown'; source: string }
  | { kind: 'image'; src: string; alt: string }
  | { kind: 'iframe'; src: string };

/** Default grid footprint (Gridstack 12-column units) for a freshly added tile. */
export const DEFAULT_LAYOUTS: Record<DashboardTile['kind'], { w: number; h: number }> = {
  'wal-embed': { w: 6, h: 4 },
  markdown: { w: 6, h: 3 },
  image: { w: 4, h: 3 },
  iframe: { w: 6, h: 4 },
};

/** Human label for a tile kind, used by the palette chips and tile headers. */
export function tileKindLabel(kind: DashboardTile['kind']): string {
  switch (kind) {
    case 'markdown':
      return msg('Markdown');
    case 'image':
      return msg('Image');
    case 'wal-embed':
      return msg('Asset');
    case 'iframe':
      return msg('Web');
  }
}

/**
 * Cycle of background colors a tile can take. `undefined` = default (the
 * tile-content's normal background). The keys are stable identifiers stored in
 * `DashboardTileEntry.color`; {@link TILE_COLOR_CSS} maps them to CSS colors at
 * render time. To add a swatch, append the key here and add its CSS below.
 */
export const TILE_COLOR_CYCLE: Array<string | undefined> = [
  undefined,
  'transparent',
  'green',
  'blue',
  'yellow',
  'pink',
  'lavender',
];

export const TILE_COLOR_CSS: Record<string, string> = {
  transparent: 'transparent',
  green: '#e3efd4',
  blue: '#d5e6f3',
  yellow: '#fff3c8',
  pink: '#f9dcdc',
  lavender: '#e6dcf5',
};

/**
 * Map a tile's `color` field to the inline style string for its tile-content.
 * `'transparent'` also drops the visible border so the tile blends into the
 * dashboard background; other colors keep the default border defined in CSS.
 */
export function tileColorStyle(color: string | undefined): string {
  if (!color) return '';
  const css = TILE_COLOR_CSS[color];
  if (!css) return '';
  if (color === 'transparent') {
    return 'background: transparent; border-color: transparent;';
  }
  return `background: ${css};`;
}

/** Next color in {@link TILE_COLOR_CYCLE} after the current one (wraps). */
export function nextTileColor(color: string | undefined): string | undefined {
  const idx = TILE_COLOR_CYCLE.indexOf(color);
  return TILE_COLOR_CYCLE[(idx + 1) % TILE_COLOR_CYCLE.length];
}

/**
 * Whether a tile is eligible for fill-height: it must be the bottom-most tile
 * across its column span (nothing extends below its bottom edge in any
 * overlapping column). Growing a tile that has something below it would just
 * push those tiles down indefinitely, so it's forbidden.
 */
export function canFillHeight(entry: DashboardTileEntry, tiles: DashboardTileEntry[]): boolean {
  const aL = entry.layout.x;
  const aR = entry.layout.x + entry.layout.w;
  const aBottom = entry.layout.y + entry.layout.h;
  return !tiles.some((u) => {
    if (u.id === entry.id) return false;
    const overlapX = u.layout.x < aR && u.layout.x + u.layout.w > aL;
    if (!overlapX) return false;
    return u.layout.y + u.layout.h > aBottom; // u extends below entry
  });
}

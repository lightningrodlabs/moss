import { describe, expect, it } from 'vitest';
import { morphTransform } from './sync-morph.js';

describe('morphTransform', () => {
  it('translates and scales the icon onto the header icon', () => {
    expect(
      morphTransform(
        { left: 500, top: 300, width: 120, height: 120 },
        { left: 260, top: 60, width: 64, height: 64 },
      ),
    ).toBe('translate(-240px, -240px) scale(0.5333)');
  });
  it('returns undefined when the target is missing or collapsed', () => {
    const from = { left: 0, top: 0, width: 120, height: 120 };
    expect(morphTransform(from, undefined)).toBeUndefined();
    expect(morphTransform(from, { left: 0, top: 0, width: 0, height: 0 })).toBeUndefined();
  });
});

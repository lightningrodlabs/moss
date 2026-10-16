import { describe, expect, it } from 'vitest';
import { breakingVersion } from './utils';

/**
 * The profile folder and the default network seed derive from this value, so
 * the Holochain 0.7.1 line must not share them with the 0.7.0 dev builds.
 */
describe('breakingVersion', () => {
  it('keeps the 0.7.1 release candidates apart from the 0.7.0 dev builds', () => {
    expect(breakingVersion('0.16.0-rc.1')).toBe('0.16.0-rc');
    expect(breakingVersion('0.16.0-dev.11')).toBe('0.16.0-dev');
    expect(breakingVersion('0.16.0-rc.1')).not.toBe(breakingVersion('0.16.0-dev.10'));
  });

  it('gives the final 0.16.0 its own folder as well', () => {
    expect(breakingVersion('0.16.0')).toBe('0.16.x');
  });
});

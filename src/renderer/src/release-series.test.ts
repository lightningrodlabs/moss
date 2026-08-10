import { describe, it, expect } from 'vitest';
import { releaseSeriesFromVersion } from './release-series.js';

describe('releaseSeriesFromVersion', () => {
  it('reads the series off release and prerelease versions alike', () => {
    expect(releaseSeriesFromVersion('0.16.0')).toBe('0.16.x');
    expect(releaseSeriesFromVersion('0.16.0-dev.2')).toBe('0.16.x');
    expect(releaseSeriesFromVersion('0.15.3')).toBe('0.15.x');
    expect(releaseSeriesFromVersion('1.2.0-rc.1')).toBe('1.2.x');
  });

  /**
   * Returning undefined rather than a key built from undefined keeps the caller from
   * reporting a missing news feed as a failed fetch.
   */
  it('is undefined when no series can be read', () => {
    expect(releaseSeriesFromVersion(undefined)).toBe(undefined);
    expect(releaseSeriesFromVersion('')).toBe(undefined);
    expect(releaseSeriesFromVersion('nightly')).toBe(undefined);
    expect(releaseSeriesFromVersion('0.16')).toBe(undefined);
  });
});

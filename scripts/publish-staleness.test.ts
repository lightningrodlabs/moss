import { describe, expect, it } from 'vitest';

import { findStaleDependencies } from './publish-staleness.mjs';

/**
 * The two publishes that actually broke, replayed as fixtures:
 * `@theweave/moss-types@0.7.0-dev.1` shipped on 2026-08-03, and
 * `WEAVE_PROTOCOL_VERSION` landed in its source on 2026-08-10 — so the
 * released `@theweave/utils` could not resolve it.
 */
const MOSS_TYPES_STALE = {
  dependencies: { '@theweave/moss-types': '^0.7.0-dev.0' },
  workspacePackages: {
    '@theweave/moss-types': { lastSourceChange: '2026-08-10T09:00:00Z' },
  },
  registry: {
    '@theweave/moss-types': {
      versions: {
        '0.7.0-dev.0': '2026-07-20T12:00:00Z',
        '0.7.0-dev.1': '2026-08-03T19:06:31Z',
      },
    },
  },
};

describe('findStaleDependencies', () => {
  it('flags a dependency whose newest satisfying release predates its source', () => {
    const stale = findStaleDependencies(MOSS_TYPES_STALE);
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({
      name: '@theweave/moss-types',
      reason: 'stale',
      resolvedVersion: '0.7.0-dev.1',
      publishedAt: '2026-08-03T19:06:31Z',
      lastSourceChange: '2026-08-10T09:00:00Z',
    });
  });

  it('clears the same dependency once a newer release is published', () => {
    const stale = findStaleDependencies({
      ...MOSS_TYPES_STALE,
      registry: {
        '@theweave/moss-types': {
          versions: {
            ...MOSS_TYPES_STALE.registry['@theweave/moss-types'].versions,
            '0.7.0-dev.2': '2026-09-02T13:06:40Z',
          },
        },
      },
    });
    expect(stale).toEqual([]);
  });

  it('resolves the newest satisfying version, not the newest overall', () => {
    // A 0.8 line exists but the range pins 0.7; the 0.7 release is current.
    const stale = findStaleDependencies({
      dependencies: { '@theweave/api': '^0.7.0-dev.0' },
      workspacePackages: { '@theweave/api': { lastSourceChange: '2026-08-01T00:00:00Z' } },
      registry: {
        '@theweave/api': {
          versions: {
            '0.7.0-dev.2': '2026-08-11T22:58:18Z',
            '0.8.0-dev.0': '2026-06-01T00:00:00Z',
          },
        },
      },
    });
    expect(stale).toEqual([]);
  });

  it('flags a range no published version satisfies', () => {
    const stale = findStaleDependencies({
      dependencies: { '@theweave/utils': '^0.7.0-dev.9' },
      workspacePackages: { '@theweave/utils': { lastSourceChange: '2026-08-01T00:00:00Z' } },
      registry: {
        '@theweave/utils': { versions: { '0.7.0-dev.1': '2026-08-03T19:06:41Z' } },
      },
    });
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({
      name: '@theweave/utils',
      reason: 'unpublished',
      resolvedVersion: null,
    });
  });

  it('flags a dependency the registry knows nothing about', () => {
    const stale = findStaleDependencies({
      dependencies: { '@theweave/brand-new': '^0.1.0' },
      workspacePackages: { '@theweave/brand-new': { lastSourceChange: '2026-08-01T00:00:00Z' } },
      registry: {},
    });
    expect(stale).toHaveLength(1);
    expect(stale[0].reason).toBe('unpublished');
  });

  it('ignores dependencies with no workspace package to compare against', () => {
    const stale = findStaleDependencies({
      dependencies: { '@holochain/client': '^0.21.0', lodash: '^4.0.0' },
      workspacePackages: {},
      registry: {},
    });
    expect(stale).toEqual([]);
  });

  it('treats a release published the same moment as the source change as current', () => {
    const stale = findStaleDependencies({
      dependencies: { '@theweave/utils': '^0.7.0-dev.0' },
      workspacePackages: { '@theweave/utils': { lastSourceChange: '2026-08-03T19:06:41Z' } },
      registry: {
        '@theweave/utils': { versions: { '0.7.0-dev.1': '2026-08-03T19:06:41Z' } },
      },
    });
    expect(stale).toEqual([]);
  });
});

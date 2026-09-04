import { describe, it, expect } from 'vitest';
import { DistributionInfo, LocalToolInfo } from '@theweave/moss-types';
import { ToolAndCurationInfo } from '../types.js';
import { mergeLocalTools, toolAndCurationInfoFromLocal } from './local-tools.js';

const distributionInfo: DistributionInfo = {
  type: 'web2-tool-list',
  info: {
    toolListUrl: 'https://collective.example/tools.json',
    developerCollectiveId: 'collective',
    toolId: 'presence',
    toolName: 'Presence',
    versionBranch: '1',
    toolVersion: '1.2.3',
    toolCompatibilityId: 'compat-presence',
  },
} as DistributionInfo;

const local: LocalToolInfo = {
  toolCompatibilityId: 'compat-presence',
  distributionInfo,
  happSha256: 'a'.repeat(64),
  uiSha256: 'b'.repeat(64),
  webhappSha256: 'c'.repeat(64),
  icon: 'data:image/png;base64,ICON',
  installedAt: 1_700_000_000_000,
};

describe('toolAndCurationInfoFromLocal', () => {
  it('carries the name, icon and on-disk hashes into a library-shaped entry', () => {
    const entry = toolAndCurationInfoFromLocal(local)!;
    expect(entry.toolCompatibilityId).toBe('compat-presence');
    expect(entry.toolInfoAndVersions.title).toBe('Presence');
    expect(entry.toolInfoAndVersions.id).toBe('presence');
    expect(entry.toolInfoAndVersions.versionBranch).toBe('1');
    expect(entry.toolInfoAndVersions.icon).toBe('data:image/png;base64,ICON');
    expect(entry.latestVersion.hashes).toEqual({
      happSha256: 'a'.repeat(64),
      uiSha256: 'b'.repeat(64),
      webhappSha256: 'c'.repeat(64),
    });
    expect(entry.latestVersion.version).toBe('1.2.3');
    expect(entry.latestVersion.releasedAt).toBe(1_700_000_000_000);
    expect(entry.availableLocally).toBe(true);
    // Nothing to download; the install path uses the assets already on disk.
    expect(entry.latestVersion.url).toBe('');
    expect(entry.curationInfos).toEqual([]);
  });

  it('is the only version offered, so an install cannot pick an absent one', () => {
    const entry = toolAndCurationInfoFromLocal(local)!;
    expect(entry.toolInfoAndVersions.versions).toEqual([entry.latestVersion]);
  });

  it('declines a Tool that did not come from a web2 tool list', () => {
    expect(
      toolAndCurationInfoFromLocal({ ...local, distributionInfo: { type: 'filesystem' } }),
    ).toBeUndefined();
  });
});

describe('mergeLocalTools', () => {
  const libraryEntry = { toolCompatibilityId: 'compat-presence' } as ToolAndCurationInfo;

  it('adds a locally held Tool the lists do not offer', () => {
    const merged = mergeLocalTools({}, [local]);
    expect(Object.keys(merged)).toEqual(['compat-presence']);
    expect(merged['compat-presence'].availableLocally).toBe(true);
  });

  it('leaves a Tool the lists already describe untouched', () => {
    const merged = mergeLocalTools({ 'compat-presence': libraryEntry }, [local]);
    expect(merged['compat-presence']).toBe(libraryEntry);
    expect(merged['compat-presence'].availableLocally).toBeUndefined();
  });

  it('does not mutate the library record it was given', () => {
    const library: Record<string, ToolAndCurationInfo> = {};
    mergeLocalTools(library, [local]);
    expect(library).toEqual({});
  });

  it('keeps other library entries alongside the local one', () => {
    const other = { toolCompatibilityId: 'compat-other' } as ToolAndCurationInfo;
    const merged = mergeLocalTools({ 'compat-other': other }, [local]);
    expect(Object.keys(merged).sort()).toEqual(['compat-other', 'compat-presence']);
  });
});

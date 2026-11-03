import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  isFromOlderVersion,
  legacyImportMode,
  parseBreakingVersion,
  scanLegacyProfiles,
  selectLegacyProfiles,
  LegacyProfileInfo,
} from './legacyProfiles';

let root: string;

function makeProfile(
  appFolder: string,
  versionString: string,
  profile: string,
  opts: { pubkey?: boolean; lairVersion?: string; mtime?: number } = {},
) {
  const keystore = path.join(root, appFolder, versionString, profile, 'data', 'keystore');
  fs.mkdirSync(keystore, { recursive: true });
  fs.writeFileSync(path.join(keystore, 'lair-keystore-config.yaml'), '');
  if (opts.pubkey !== false) fs.writeFileSync(path.join(keystore, 'moss-agent-pubkey.txt'), 'k');
  if (opts.lairVersion)
    fs.writeFileSync(path.join(keystore, 'moss-lair-version.txt'), opts.lairVersion);
  if (opts.mtime !== undefined) {
    const t = new Date(opts.mtime);
    fs.utimesSync(keystore, t, t);
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-legacy-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('parseBreakingVersion', () => {
  it('reads the breaking version from a Moss app folder name', () => {
    expect(parseBreakingVersion('org.lightningrodlabs.moss-0.15')).toEqual([0, 15]);
    expect(parseBreakingVersion('org.lightningrodlabs.moss-0.16-dev')).toEqual([0, 16]);
    expect(parseBreakingVersion('Moss')).toBeUndefined();
  });
});

describe('scanLegacyProfiles', () => {
  const current = {
    appFolderName: 'org.lightningrodlabs.moss-0.16',
    versionString: '0.16.0-rc',
    profileName: 'default',
  };

  it('finds profiles with an initialized keystore and a recorded agent pubkey', () => {
    makeProfile('org.lightningrodlabs.moss-0.15', '0.15.x', 'default', {
      lairVersion: 'lair_keystore 0.6.3',
    });
    makeProfile('org.lightningrodlabs.moss-0.15', '0.15.x', 'nopubkey', { pubkey: false });
    makeProfile('unrelated-app', '1.0', 'default');
    const found = scanLegacyProfiles(root, current);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      appName: 'org.lightningrodlabs.moss-0.15',
      versionString: '0.15.x',
      profileName: 'default',
      lairVersion: 'lair_keystore 0.6.3',
    });
  });

  it('excludes the profile that is currently running', () => {
    makeProfile('org.lightningrodlabs.moss-0.16', '0.16.0-rc', 'default');
    makeProfile('org.lightningrodlabs.moss-0.16', '0.16.0-rc', 'other');
    expect(scanLegacyProfiles(root, current).map((p) => p.profileName)).toEqual(['other']);
  });
});

describe('selectLegacyProfiles', () => {
  const p = (appName: string, versionString: string, profileName: string, lastUsed = 0) =>
    ({
      appName,
      versionString,
      profileName,
      keystorePath: `/${appName}/${versionString}/${profileName}`,
      lairVersion: undefined,
      lastUsed,
    }) satisfies LegacyProfileInfo;

  const all = [
    p('org.lightningrodlabs.moss-0.14', '0.14.x', 'default', 50),
    p('org.lightningrodlabs.moss-0.15', '0.15.0-rc', 'default', 10),
    p('org.lightningrodlabs.moss-0.15', '0.15.x', 'default', 20),
    p('org.lightningrodlabs.moss-0.15', '0.15.x', 'test', 30),
    p('org.lightningrodlabs.moss-0.16', '0.16.0-dev', 'default', 99),
    p('org.lightningrodlabs.moss-0.17', '0.17.x', 'default', 99),
  ];
  const current = { appFolderName: 'org.lightningrodlabs.moss-0.16', profileName: 'default' };

  it('upgrade offers only older versions of the same profile name, newest first', () => {
    const picked = selectLegacyProfiles(all, 'upgrade', current);
    expect(picked.map((x) => `${x.versionString}/${x.profileName}`)).toEqual([
      '0.15.x/default',
      '0.15.0-rc/default',
      '0.14.x/default',
    ]);
  });

  it('upgrade matches on the running profile name', () => {
    const picked = selectLegacyProfiles(all, 'upgrade', { ...current, profileName: 'test' });
    expect(picked.map((x) => `${x.versionString}/${x.profileName}`)).toEqual(['0.15.x/test']);
  });

  it('upgrade from a dev build still offers released profiles', () => {
    const picked = selectLegacyProfiles(all, 'upgrade', {
      ...current,
      appFolderName: 'org.lightningrodlabs.moss-0.16-dev',
    });
    expect(picked[0].versionString).toBe('0.15.x');
  });

  it('fork offers every profile, newest version first', () => {
    const picked = selectLegacyProfiles(all, 'fork', current);
    expect(picked.map((x) => `${x.versionString}/${x.profileName}`)).toEqual([
      '0.17.x/default',
      '0.16.0-dev/default',
      '0.15.x/test',
      '0.15.x/default',
      '0.15.0-rc/default',
      '0.14.x/default',
    ]);
  });
});

describe('legacyImportMode', () => {
  it('offers an upgrade on a plain launch', () => {
    expect(legacyImportMode({ profile: undefined, fork: undefined, update: false })).toBe(
      'upgrade',
    );
  });
  it('skips the offer for a custom profile', () => {
    expect(legacyImportMode({ profile: 'x', fork: undefined, update: false })).toBeUndefined();
  });
  it('offers an upgrade for a custom profile with --update', () => {
    expect(legacyImportMode({ profile: 'x', fork: undefined, update: true })).toBe('upgrade');
  });
  it('offers a fork with --fork', () => {
    expect(legacyImportMode({ profile: 'x', fork: 'a', update: false })).toBe('fork');
  });
});

describe('isFromOlderVersion', () => {
  const current = '/c/org.lightningrodlabs.moss-0.16/0.16.0-rc/test';
  it('detects a keystore from an earlier Moss version', () => {
    expect(
      isFromOlderVersion('/c/org.lightningrodlabs.moss-0.15/0.15.x/test/data/keystore', current),
    ).toBe(true);
  });
  it('treats the same Moss version as not older', () => {
    expect(
      isFromOlderVersion('/c/org.lightningrodlabs.moss-0.16/0.16.0-dev/a/data/keystore', current),
    ).toBe(false);
  });
});

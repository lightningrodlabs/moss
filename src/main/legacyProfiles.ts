import fs from 'fs';
import path from 'path';

/**
 * Discovery of Moss profiles from other installs on this machine, so a first launch
 * can offer to carry over an identity and groups.
 *
 * - 'upgrade': moving from an older Moss version to this one. Only older versions of
 *   the profile being launched are offered.
 * - 'fork': deliberately starting a copy of any existing profile on new networks
 *   (the --fork suffix is appended to every imported network seed).
 */
export type LegacyImportMode = 'upgrade' | 'fork';

export interface LegacyProfileInfo {
  /** App folder name, e.g. "org.lightningrodlabs.moss-0.15" */
  appName: string;
  /** Version folder name, e.g. "0.15.x" */
  versionString: string;
  /** Profile name, e.g. "default" */
  profileName: string;
  /** Absolute path to the legacy keystore directory */
  keystorePath: string;
  /** Lair binary version that created this keystore, if recorded */
  lairVersion: string | undefined;
  /** Last modification time (ms) of the profile's data, used to put recent profiles first */
  lastUsed: number;
}

export interface LegacyImportOffer {
  mode: LegacyImportMode;
  profiles: LegacyProfileInfo[];
}

const APP_FOLDER_PREFIX = 'org.lightningrodlabs.moss-';

/** Breaking version [major, minor] from an app folder name like "org.lightningrodlabs.moss-0.15-dev". */
export function parseBreakingVersion(appFolderName: string): [number, number] | undefined {
  const m = appFolderName.match(/^org\.lightningrodlabs\.moss-(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

function compareVersions(a: [number, number], b: [number, number]): number {
  return a[0] - b[0] || a[1] - b[1];
}

function subdirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((name) => {
      try {
        return fs.statSync(path.join(dir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function mtime(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Walks <rootDir>/<appFolder>/<versionString>/<profile> for Moss profiles that have an
 * initialized lair keystore and a recorded agent pubkey. The running profile is excluded.
 */
export function scanLegacyProfiles(
  rootDir: string,
  current: { appFolderName: string; versionString: string; profileName: string },
): LegacyProfileInfo[] {
  const results: LegacyProfileInfo[] = [];
  for (const appName of subdirs(rootDir).filter((n) => n.startsWith(APP_FOLDER_PREFIX))) {
    const appDir = path.join(rootDir, appName);
    for (const versionString of subdirs(appDir)) {
      const versionDir = path.join(appDir, versionString);
      for (const profileName of subdirs(versionDir)) {
        if (
          appName === current.appFolderName &&
          versionString === current.versionString &&
          profileName === current.profileName
        ) {
          continue;
        }
        const profileDir = path.join(versionDir, profileName);
        const keystorePath = path.join(profileDir, 'data', 'keystore');
        if (
          !fs.existsSync(path.join(keystorePath, 'lair-keystore-config.yaml')) ||
          !fs.existsSync(path.join(keystorePath, 'moss-agent-pubkey.txt'))
        ) {
          continue;
        }
        const lairVersionFile = path.join(keystorePath, 'moss-lair-version.txt');
        const lairVersion = fs.existsSync(lairVersionFile)
          ? fs.readFileSync(lairVersionFile, 'utf-8').trim()
          : undefined;
        const lastUsed = Math.max(
          mtime(keystorePath),
          mtime(path.join(profileDir, 'data', 'conductor')),
          mtime(path.join(profileDir, 'logs')),
        );
        results.push({ appName, versionString, profileName, keystorePath, lairVersion, lastUsed });
      }
    }
  }
  return results;
}

/**
 * Narrows the scanned profiles to the ones offered for the given mode, ordered newest
 * Moss version first and then most recently used first.
 */
export function selectLegacyProfiles(
  profiles: LegacyProfileInfo[],
  mode: LegacyImportMode,
  current: { appFolderName: string; profileName: string },
): LegacyProfileInfo[] {
  const currentVersion = parseBreakingVersion(current.appFolderName);
  const withVersion = profiles
    .map((p) => ({ p, v: parseBreakingVersion(p.appName) }))
    .filter((x): x is { p: LegacyProfileInfo; v: [number, number] } => x.v !== undefined);

  const offered =
    mode === 'fork'
      ? withVersion
      : withVersion.filter(
          ({ p, v }) =>
            currentVersion !== undefined &&
            compareVersions(v, currentVersion) < 0 &&
            p.profileName === current.profileName,
        );

  return offered
    .sort((a, b) => compareVersions(b.v, a.v) || b.p.lastUsed - a.p.lastUsed)
    .map(({ p }) => p);
}

/**
 * Which import offer a first launch shows. A custom --profile normally means a fresh,
 * dedicated data store, so it gets no offer unless --update or --fork asks for one.
 */
export function legacyImportMode(opts: {
  profile: string | undefined;
  fork: string | undefined;
  update: boolean;
}): LegacyImportMode | undefined {
  if (opts.fork) return 'fork';
  if (opts.update || !opts.profile) return 'upgrade';
  return undefined;
}

/**
 * Finds the profiles to offer for import. The Electron userData path after
 * MossFileSystem.connect() is <rootDir>/<appFolderName>/<versionString>/<profile>.
 */
export function findLegacyImportOffer(
  userDataPath: string,
  mode: LegacyImportMode,
): LegacyImportOffer {
  const versionDir = path.dirname(userDataPath);
  const appDir = path.dirname(versionDir);
  const current = {
    appFolderName: path.basename(appDir),
    versionString: path.basename(versionDir),
    profileName: path.basename(userDataPath),
  };
  const profiles = scanLegacyProfiles(path.dirname(appDir), current);
  return { mode, profiles: selectLegacyProfiles(profiles, mode, current) };
}

/**
 * Whether the profile owning `keystorePath` (<root>/<appFolder>/<version>/<profile>/data/keystore)
 * belongs to an earlier Moss version than the one running at `userDataPath`.
 */
export function isFromOlderVersion(keystorePath: string, userDataPath: string): boolean {
  const sourceApp = path.basename(path.resolve(keystorePath, '..', '..', '..', '..'));
  const currentApp = path.basename(path.dirname(path.dirname(userDataPath)));
  const source = parseBreakingVersion(sourceApp);
  const current = parseBreakingVersion(currentApp);
  return !!source && !!current && compareVersions(source, current) < 0;
}

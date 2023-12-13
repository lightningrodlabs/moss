import path from 'path';
import fs from 'fs';
import semver from 'semver';
import { ActionHashB64, DnaHashB64, EntryHashB64, InstalledAppId } from '@holochain/client';

export type Profile = string;
export type UiIdentifier = string;

export type AppAssetsInfo =
  | {
      type: 'happ';
      assetSource: AssetSource; // Source of the actual asset bytes
      distributionInfo: DistributionInfo; // Info about the distribution channel (e.g. appstore hashes)
      sha256: string; // sha256 hash of the .happ file
    }
  | {
      type: 'webhapp';
      assetSource: AssetSource;
      distributionInfo: DistributionInfo; // Info about the distribution channel (e.g. appstore hashes)
      sha256?: string; // sha256 hash of the .webhapp file
      happ: {
        sha256: string; // sha256 hash of the .happ file. Will also define the name of the .happ file
        dnas?: any; // sha256 hashes of dnas and zomes
      };
      ui: {
        location:
          | {
              type: 'filesystem';
              sha256: string; // Also defines the foldername where the unzipped assets are stored
            }
          | {
              type: 'localhost';
              port: number;
            };
      };
    };

export type AssetSource =
  | {
      type: 'https';
      url: string;
    }
  | {
      type: 'filesystem'; // Installed from filesystem
    };

/**
 * Info about the distribution channel of said app
 */
export type DistributionInfo =
  | {
      type: 'appstore-light';
      info: {
        appstoreDnaHash: DnaHashB64;
        // according to https://docs.rs/hc_crud_caps/0.10.3/hc_crud/struct.Entity.html
        appEntryId: ActionHashB64;
        appEntryActionHash: ActionHashB64;
        appEntryEntryHash: EntryHashB64;
      };
    }
  | {
      type: 'filesystem'; // Installed from filesystem
    };

export class WeFileSystem {
  public appDataDir: string;
  public appConfigDir: string;
  public appLogsDir: string;

  public conductorDir: string;
  public keystoreDir: string;
  public appsDir: string;
  public happsDir: string;
  public uisDir: string;
  public iconsDir: string;

  constructor(appDataDir: string, appConfigDir: string, appLogsDir: string) {
    this.appDataDir = appDataDir;
    this.appConfigDir = appConfigDir;
    this.appLogsDir = appLogsDir;

    this.conductorDir = path.join(appDataDir, 'conductor');
    this.keystoreDir = path.join(appDataDir, 'keystore');
    this.appsDir = path.join(appDataDir, 'apps');
    this.happsDir = path.join(appDataDir, 'happs');
    this.uisDir = path.join(appDataDir, 'uis');
    this.iconsDir = path.join(appDataDir, 'icons');

    createDirIfNotExists(this.conductorDir);
    createDirIfNotExists(this.keystoreDir);
    createDirIfNotExists(this.appsDir);
    createDirIfNotExists(this.happsDir);
    createDirIfNotExists(this.uisDir);
    createDirIfNotExists(this.iconsDir);
  }

  static connect(app: Electron.App, profile?: Profile, tempDir?: string) {
    profile = profile ? profile : 'default';
    const versionString = breakingAppVersion(app);

    const defaultLogsPath = app.getPath('logs');
    console.log('defaultLogsPath: ', defaultLogsPath);
    // app.setPath('logs', path.join(defaultLogsPath, profile));
    const defaultUserDataPath = app.getPath('userData');
    console.log('defaultUserDataPath: ', defaultUserDataPath);
    // check whether userData path has already been modified, otherwise, set paths to point
    // to the profile-specific paths
    if (!defaultUserDataPath.endsWith(profile)) {
      const rootDir = tempDir ? tempDir : defaultUserDataPath;

      app.setPath('logs', path.join(rootDir, versionString, profile, 'logs'));
      app.setAppLogsPath(path.join(rootDir, versionString, profile, 'logs'));
      app.setPath('userData', path.join(rootDir, versionString, profile));
      app.setPath('sessionData', path.join(rootDir, versionString, profile, 'chromium'));
      fs.rmdirSync(defaultLogsPath);
    }

    // app.setPath()
    // app.setAppLogsPath([path])
    // const

    const logsDir = app.getPath('logs');
    const configDir = path.join(app.getPath('userData'), 'config');
    const dataDir = path.join(app.getPath('userData'), 'data');

    createDirIfNotExists(logsDir);
    createDirIfNotExists(configDir);
    createDirIfNotExists(dataDir);

    console.log('Got logsDir, configDir and dataDir: ', logsDir, configDir, dataDir);

    const launcherFileSystem = new WeFileSystem(dataDir, configDir, logsDir);

    return launcherFileSystem;
  }

  get conductorConfigPath() {
    return path.join(this.conductorDir, 'conductor-config.yaml');
  }

  appUiDir(appId: string): string | undefined {
    const appAssetsInfo = this.readAppAssetsInfo(appId);
    if (appAssetsInfo.type === 'webhapp') {
      if (appAssetsInfo.ui.location.type === 'filesystem') {
        return path.join(this.uisDir, appAssetsInfo.ui.location.sha256);
      }
    }
    return undefined;
  }

  appUiAssetsDir(appId: string): string | undefined {
    const appUiDir = this.appUiDir(appId);
    if (appUiDir) {
      return path.join(appUiDir, 'assets');
    }
    return undefined;
  }

  keystoreInitialized = () => {
    return fs.existsSync(path.join(this.keystoreDir, 'lair-keystore-config.yaml'));
  };

  /**
   * Stores information about happ and (optionally) UI of an installed app
   *
   * @param installedAppId
   * @param info
   */
  storeAppAssetsInfo(installedAppId: InstalledAppId, info: AppAssetsInfo) {
    const filePath = path.join(this.appsDir, `${installedAppId}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(info), 'utf-8');
    } catch (e) {
      throw new Error(`Failed to write app assets info to json file: ${e}`);
    }
  }

  backupAppAssetsInfo(installedAppId: InstalledAppId) {
    const fileToBackup = path.join(this.appsDir, `${installedAppId}.json`);
    const backupPath = path.join(this.appsDir, `${installedAppId}.json.previous`);
    try {
      fs.copyFileSync(fileToBackup, backupPath);
    } catch (e) {
      throw new Error(`Failed to backup app assets info for app Id ''${installedAppId}: ${e}`);
    }
  }

  readAppAssetsInfo(installedAppId: InstalledAppId): AppAssetsInfo {
    const filePath = path.join(this.appsDir, `${installedAppId}.json`);
    let appAssetsInfoJson: string | undefined;
    try {
      appAssetsInfoJson = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      throw new Error(`Failed to read app assets info json file at path ${filePath}: ${e}`);
    }
    try {
      const appAssetsInfo: AppAssetsInfo = JSON.parse(appAssetsInfoJson);
      return appAssetsInfo;
    } catch (e) {
      throw new Error(`Failed to parse app assets info: ${e}`);
    }
  }
}

function createDirIfNotExists(path: fs.PathLike) {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path, { recursive: true });
  }
}

export function deriveAppAssetsInfo(
  distributionInfo: DistributionInfo,
  happOrWebHappUrl: string,
  sha256Happ: string,
  sha256Webhapp?: string,
  sha256Ui?: string,
  uiPort?: number,
): AppAssetsInfo {
  return sha256Webhapp
    ? {
        type: 'webhapp',
        sha256: sha256Webhapp,
        assetSource: {
          type: 'https',
          url: happOrWebHappUrl,
        },
        distributionInfo,
        happ: {
          sha256: sha256Happ,
        },
        ui: {
          location: {
            type: 'filesystem',
            sha256: sha256Ui!,
          },
        },
      }
    : uiPort
      ? {
          type: 'webhapp',
          assetSource: {
            type: 'https',
            url: happOrWebHappUrl,
          },
          distributionInfo,
          happ: {
            sha256: sha256Happ,
          },
          ui: {
            location: {
              type: 'localhost',
              port: uiPort,
            },
          },
        }
      : {
          type: 'happ',
          sha256: sha256Happ,
          assetSource: {
            type: 'https',
            url: happOrWebHappUrl,
          },
          distributionInfo,
        };
}

export function breakingAppVersion(app: Electron.App): string {
  const version = app.getVersion();
  if (!semver.valid(version)) {
    throw new Error('App has an invalid version number.');
  }
  if (semver.prerelease(version)) {
    return version;
  }
  switch (semver.major(version)) {
    case 0:
      switch (semver.minor(version)) {
        case 0:
          return `0.0.${semver.patch(version)}`;
        default:
          return `0.${semver.minor(version)}.x`;
      }
    default:
      return `${semver.major(version)}.x.x`;
  }
}

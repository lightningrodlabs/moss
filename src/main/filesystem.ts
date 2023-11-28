import path from 'path';
import fs from 'fs';
import semver from 'semver';
import { InstalledAppId } from '@holochain/client';

export type Profile = string;
export type UiIdentifier = string;

export interface AppAssetsInfo {
  happ: {
    source: unknown; // e.g. dnahash+entry hash in the devhub
    shasum: string; // sha256 hash of the .happ file
    identifier: string; // e.g. entry hash in the devhub, must be unique to prevent accidental collisions
  };
  ui?: {
    source: unknown;
    // shasum: string; // not quite clear what the shasum would be taken from
    identifier: string;
  };
}

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

  static connect(app: Electron.App, profile?: Profile) {
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
      app.setPath('logs', path.join(defaultUserDataPath, versionString, profile, 'logs'));
      app.setAppLogsPath(path.join(defaultUserDataPath, versionString, profile, 'logs'));
      app.setPath('userData', path.join(defaultUserDataPath, versionString, profile));
      app.setPath(
        'sessionData',
        path.join(defaultUserDataPath, versionString, profile, 'chromium'),
      );
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
    const uiIdentifier = appAssetsInfo.ui?.identifier;
    if (uiIdentifier) {
      return path.join(this.uisDir, uiIdentifier);
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

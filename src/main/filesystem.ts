import path from 'path';
import fs from 'fs';
import semver from 'semver';
import { InstalledAppId } from '@holochain/client';
import { ToolUserPreferences } from './sharedTypes';
import { session } from 'electron';
import { platform } from '@electron-toolkit/utils';
import { AppAssetsInfo, DistributionInfo } from '@theweave/moss-types';

export type Profile = string;
export type UiIdentifier = string;

export type AssetSource =
  | {
      type: 'https';
      url: string;
    }
  | {
      type: 'filesystem'; // Installed from filesystem
    }
  | {
      type: 'default-app'; // Shipped with the We executable by default
    };

export class MossFileSystem {
  public profileDataDir: string;
  public profileConfigDir: string;
  public profileLogsDir: string;

  public conductorDir: string;
  public keystoreDir: string;
  public appsDir: string;
  /**
   * This is the directory where information about Tools (i.e. not instances
   * but Tool as the class) is stored
   */
  public toolsDir: string;
  public happsDir: string;
  public uisDir: string;
  public iconsDir: string;

  constructor(profileDataDir: string, profileConfigDir: string, profileLogsDir: string) {
    this.profileDataDir = profileDataDir;
    this.profileConfigDir = profileConfigDir;
    this.profileLogsDir = profileLogsDir;

    this.conductorDir = path.join(profileDataDir, 'conductor');
    this.keystoreDir = path.join(profileDataDir, 'keystore');
    this.appsDir = path.join(profileDataDir, 'apps');
    this.toolsDir = path.join(profileDataDir, 'tools');
    this.happsDir = path.join(profileDataDir, 'happs');
    this.uisDir = path.join(profileDataDir, 'uis');
    this.iconsDir = path.join(profileDataDir, 'icons');

    createDirIfNotExists(this.conductorDir);
    createDirIfNotExists(this.keystoreDir);
    createDirIfNotExists(this.appsDir);
    createDirIfNotExists(this.toolsDir);
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

    console.log('dataDir: ', dataDir);
    console.log('logsDir: ', logsDir);
    console.log('configDir: ', configDir);

    const mossFileSystem = new MossFileSystem(dataDir, configDir, logsDir);

    return mossFileSystem;
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

  /**
   * Directory of an app (e.g. a Tool instance) where meta data about it is stored,
   * e.g. user preferences
   *
   * @param appId
   * @returns
   */
  appMetaDataDir(appId: string) {
    return path.join(this.appsDir, appId);
  }

  /**
   * Directory for data related to a Tool (not the instance but the class)
   *
   * Initially, the toolId will be the originalToolActionHash from the tool-library
   *
   * @param toolId Identifier of a Tool (not the instance but the class)
   * @returns
   */
  toolDir(toolId: string) {
    return path.join(this.toolsDir, toolId);
  }

  toolUserPreferencesPath(toolId: string) {
    return path.join(this.toolDir(toolId), 'preferences.json');
  }

  toolIconPath(toolId: string) {
    return path.join(this.toolDir(toolId), 'icon');
  }

  toolUserPreferences(toolId: string): ToolUserPreferences | undefined {
    const filePath = this.toolUserPreferencesPath(toolId);
    let userPreferencesJson: string | undefined;
    try {
      userPreferencesJson = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      // console.warn(`Failed to read user preferences at path ${filePath}: ${e}`);
      return undefined;
    }
    try {
      const userPreferences: ToolUserPreferences = JSON.parse(userPreferencesJson);
      return userPreferences;
    } catch (e) {
      console.warn(
        `Failed to parse user preferences: ${e}.\nWill try to remove corrupted user preferences.`,
      );
      try {
        fs.rmSync(filePath);
      } catch (e) {
        console.warn(`Failed to remove corrupted user preferences: ${e}`);
      }
    }
    return undefined;
  }

  appAssetInfoPath(installedAppId: InstalledAppId): string {
    return path.join(this.appMetaDataDir(installedAppId), 'info.json');
  }

  appPreviousAssetInfoPath(installedAppId: InstalledAppId): string {
    return path.join(this.appMetaDataDir(installedAppId), 'info.json.previous');
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
    const appMetaDataDir = this.appMetaDataDir(installedAppId);
    createDirIfNotExists(appMetaDataDir);
    const filePath = this.appAssetInfoPath(installedAppId);
    try {
      fs.writeFileSync(filePath, JSON.stringify(info, undefined, 4), 'utf-8');
    } catch (e) {
      throw new Error(`Failed to write app assets info to json file: ${e}`);
    }
  }

  /**
   * Stores information about happ and (optionally) UI of an installed app
   *
   * @param installedAppId
   * @param info
   */
  deleteAppAssetsInfo(installedAppId: InstalledAppId) {
    const filePath = this.appAssetInfoPath(installedAppId);
    try {
      fs.rmSync(filePath);
    } catch (e) {
      throw new Error(`Failed to delete app assets info json file: ${e}`);
    }
  }

  backupAppAssetsInfo(installedAppId: InstalledAppId) {
    const fileToBackup = this.appAssetInfoPath(installedAppId);
    const backupPath = this.appPreviousAssetInfoPath(installedAppId);
    try {
      fs.copyFileSync(fileToBackup, backupPath);
    } catch (e) {
      throw new Error(`Failed to backup app assets info for app Id '${installedAppId}': ${e}`);
    }
  }

  readAppAssetsInfo(installedAppId: InstalledAppId): AppAssetsInfo {
    const filePath = this.appAssetInfoPath(installedAppId);
    let appAssetsInfoJson: string | undefined;
    try {
      appAssetsInfoJson = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      throw new Error(`Failed to read app assets info json file at path '${filePath}': ${e}`);
    }
    try {
      const appAssetsInfo: AppAssetsInfo = JSON.parse(appAssetsInfoJson);
      return appAssetsInfo;
    } catch (e) {
      throw new Error(`Failed to parse app assets info: ${e}`);
    }
  }

  /**
   * Deletes information about happ and (optionally) UI of an installed app
   *
   * @param installedAppId
   */
  deleteAppMetaDataDir(installedAppId: InstalledAppId) {
    try {
      fs.rmSync(this.appMetaDataDir(installedAppId), { recursive: true });
    } catch (e) {
      throw new Error(`Failed to delete app metadata directory for app '${installedAppId}': ${e}`);
    }
  }

  storeToolIconIfNecessary(toolId: string, icon: string): void {
    if (!fs.existsSync(this.toolDir(toolId))) {
      createDirIfNotExists(this.toolDir(toolId));
    }
    const toolIconPath = this.toolIconPath(toolId);
    if (!fs.existsSync(toolIconPath)) {
      fs.writeFileSync(toolIconPath, icon, 'utf-8');
    }
  }

  readToolIcon(toolId: string): string | undefined {
    const toolIconPath = this.toolIconPath(toolId);
    if (fs.existsSync(toolIconPath)) {
      return fs.readFileSync(toolIconPath, 'utf-8');
    }
    return undefined;
  }

  grantCameraAccess(toolId: string) {
    const userPreferences = this.toolUserPreferences(toolId);
    if (userPreferences) {
      userPreferences.cameraAccessGranted = true;
      fs.writeFileSync(
        this.toolUserPreferencesPath(toolId),
        JSON.stringify(userPreferences),
        'utf-8',
      );
    } else {
      createDirIfNotExists(this.toolDir(toolId));
      const preferences: ToolUserPreferences = {
        cameraAccessGranted: true,
      };
      fs.writeFileSync(this.toolUserPreferencesPath(toolId), JSON.stringify(preferences), 'utf-8');
    }
  }

  grantMicrophoneAccess(toolId: string) {
    const userPreferences = this.toolUserPreferences(toolId);
    if (userPreferences) {
      userPreferences.microphoneAccessGranted = true;
      fs.writeFileSync(
        this.toolUserPreferencesPath(toolId),
        JSON.stringify(userPreferences),
        'utf-8',
      );
    } else {
      createDirIfNotExists(this.toolDir(toolId));
      const preferences: ToolUserPreferences = {
        microphoneAccessGranted: true,
      };
      fs.writeFileSync(this.toolUserPreferencesPath(toolId), JSON.stringify(preferences), 'utf-8');
    }
  }

  grantFullMediaAccess(toolId: string) {
    const userPreferences = this.toolUserPreferences(toolId);
    if (userPreferences) {
      userPreferences.fullMediaAccessGranted = true;
      fs.writeFileSync(
        this.toolUserPreferencesPath(toolId),
        JSON.stringify(userPreferences),
        'utf-8',
      );
    } else {
      createDirIfNotExists(this.toolDir(toolId));
      const preferences: ToolUserPreferences = {
        microphoneAccessGranted: true,
        cameraAccessGranted: true,
        fullMediaAccessGranted: true,
      };
      fs.writeFileSync(this.toolUserPreferencesPath(toolId), JSON.stringify(preferences), 'utf-8');
    }
  }

  async factoryReset(keepLogs = false) {
    if (keepLogs) throw new Error('Keeping logs across factory reset is currently not supported.');
    if (platform.isWindows) {
      try {
        await session.defaultSession.clearCache();
        await session.defaultSession.clearStorageData();
        await session.defaultSession.clearAuthCache();
        await session.defaultSession.clearCodeCaches({});
        await session.defaultSession.clearHostResolverCache();
      } catch (e) {
        console.warn('Failed to clear cache or parts of it: ', e);
      }
    }
    deleteRecursively(this.profileDataDir);
    deleteRecursively(this.profileLogsDir);
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
  const prerelease = semver.prerelease(version);
  if (prerelease) {
    return `${semver.major(version)}.${semver.minor(version)}.${semver.patch(version)}-${prerelease[0]}`;
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

/**
 * Deletes a folder recursively and if a file or folder fails with an EPERM error,
 * it deletes all other folders
 * @param root
 */
export function deleteRecursively(root: string) {
  try {
    console.log('Attempting to remove file or folder: ', root);
    fs.rmSync(root, { recursive: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    if (e.toString && e.toString().includes('EPERM')) {
      console.log('Got EPERM error for file or folder: ', root);
      if (fs.statSync(root).isDirectory()) {
        console.log('Removing files and subfolders.');
        const filesAndSubFolders = fs.readdirSync(root);
        filesAndSubFolders.forEach((file) => deleteRecursively(path.join(root, file)));
      }
    }
  }
}

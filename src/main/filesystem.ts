import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import semver from 'semver';
import { v4 as uuidv4 } from 'uuid';
import { DnaHashB64, InstalledAppId } from '@holochain/client';
import { ToolUserPreferences } from './sharedTypes';
import { app, dialog, session, shell } from 'electron';
import { platform } from '@electron-toolkit/utils';
import { AppAssetsInfo, DistributionInfo } from '@theweave/moss-types';
import AdmZip from 'adm-zip';
import { GroupProfile } from '@theweave/api';
import { toolCompatibilityIdFromDistInfo } from '@theweave/utils';

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
  public groupsDir: string;
  /**
   * This is the directory where information about Tools (i.e. not instances
   * but Tool as the class) is stored
   */
  public toolsDir: string;
  public happsDir: string;
  public uisDir: string;
  public iconsDir: string;
  public feedbackDir: string;

  constructor(profileDataDir: string, profileConfigDir: string, profileLogsDir: string) {
    this.profileDataDir = profileDataDir;
    this.profileConfigDir = profileConfigDir;
    this.profileLogsDir = profileLogsDir;

    this.conductorDir = path.join(profileDataDir, 'conductor');
    this.keystoreDir = path.join(profileDataDir, 'keystore');
    this.appsDir = path.join(profileDataDir, 'apps');
    this.groupsDir = path.join(profileDataDir, 'groups');
    this.toolsDir = path.join(profileDataDir, 'tools');
    this.happsDir = path.join(profileDataDir, 'happs');
    this.uisDir = path.join(profileDataDir, 'uis');
    this.iconsDir = path.join(profileDataDir, 'icons');
    this.feedbackDir = path.join(profileDataDir, 'feedback');

    createDirIfNotExists(this.conductorDir);
    createDirIfNotExists(this.keystoreDir);
    createDirIfNotExists(this.appsDir);
    createDirIfNotExists(this.groupsDir);
    createDirIfNotExists(this.toolsDir);
    createDirIfNotExists(this.happsDir);
    createDirIfNotExists(this.uisDir);
    createDirIfNotExists(this.iconsDir);
    createDirIfNotExists(this.feedbackDir);
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

  /**
   * --------------------------------------------------------------------------------
   * Apps (e.g. Tool instances)
   * --------------------------------------------------------------------------------
   */

  /**
   * Directory of an app (e.g. a Tool instance) where meta data about it is stored,
   * e.g. user preferences
   *
   * @param appId
   * @returns
   */
  appMetaDataDir(appId: string): string {
    return path.join(this.appsDir, appId);
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

  appAssetInfoPath(installedAppId: InstalledAppId): string {
    return path.join(this.appMetaDataDir(installedAppId), 'info.json');
  }

  appPreviousAssetInfoPath(installedAppId: InstalledAppId): string {
    return path.join(this.appMetaDataDir(installedAppId), 'info.json.previous');
  }

  appOriginalAssetInfoPath(installedAppId: InstalledAppId): string {
    return path.join(this.appMetaDataDir(installedAppId), 'info.json.original');
  }

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
   * @param installedAppId
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

  /**
   * Backs up the current info.json to info.json.original, but only if
   * info.json.original doesn't already exist (preserves the true production original).
   */
  backupOriginalAppAssetsInfo(installedAppId: InstalledAppId) {
    const originalPath = this.appOriginalAssetInfoPath(installedAppId);
    if (fs.existsSync(originalPath)) return; // Already have the original backed up
    const currentPath = this.appAssetInfoPath(installedAppId);
    try {
      fs.copyFileSync(currentPath, originalPath);
    } catch (e) {
      throw new Error(`Failed to backup original app assets info for app Id '${installedAppId}': ${e}`);
    }
  }

  /**
   * Restores info.json.original back to info.json, removing the original backup.
   */
  restoreOriginalAppAssetsInfo(installedAppId: InstalledAppId) {
    const originalPath = this.appOriginalAssetInfoPath(installedAppId);
    const currentPath = this.appAssetInfoPath(installedAppId);
    try {
      fs.copyFileSync(originalPath, currentPath);
      fs.rmSync(originalPath);
    } catch (e) {
      throw new Error(`Failed to restore original app assets info for app Id '${installedAppId}': ${e}`);
    }
  }

  /**
   * Checks whether the given app has a dev UI override active,
   * indicated by the UI location sha256 ending with '-dev'.
   */
  hasDevUiOverride(installedAppId: InstalledAppId): boolean {
    try {
      const info = this.readAppAssetsInfo(installedAppId);
      return (
        info.type === 'webhapp' &&
        info.ui.location.type === 'filesystem' &&
        info.ui.location.sha256.endsWith('-dev')
      );
    } catch {
      return false;
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

  /**
   * --------------------------------------------------------------------------------
   * Groups
   * --------------------------------------------------------------------------------
   */

  /**
   * Directory of a group where meta data about it is stored, e.g. the group profile
   * (image and group name)
   *
   * @param groupDnaHashB64
   * @returns
   */
  groupMetaDataDir(groupDnaHashB64: DnaHashB64): string {
    return path.join(this.groupsDir, groupDnaHashB64);
  }

  groupProfilePath(groupDnaHashB64: DnaHashB64): string {
    return path.join(this.groupMetaDataDir(groupDnaHashB64), 'profile.json');
  }

  storeGroupProfile(groupDnaHashB64: DnaHashB64, groupProfile: GroupProfile): void {
    const groupMetaDataDir = this.groupMetaDataDir(groupDnaHashB64);
    createDirIfNotExists(groupMetaDataDir);
    const filePath = this.groupProfilePath(groupDnaHashB64);
    try {
      fs.writeFileSync(filePath, JSON.stringify(groupProfile, undefined, 4), 'utf-8');
    } catch (e) {
      throw new Error(`Failed to write group profile to json file: ${e}`);
    }
  }

  readGroupProfile(groupDnaHashB64: DnaHashB64): GroupProfile | undefined {
    const filePath = this.groupProfilePath(groupDnaHashB64);
    if (!fs.existsSync(filePath)) return undefined;

    let groupProfileJson: string | undefined;
    try {
      groupProfileJson = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      throw new Error(`Failed to read group profile json file at path '${filePath}': ${e}`);
    }
    try {
      const groupProfile: GroupProfile = JSON.parse(groupProfileJson);
      return groupProfile;
    } catch (e) {
      throw new Error(`Failed to parse group profile: ${e}`);
    }
  }

  /**
   * --------------------------------------------------------------------------------
   * Tools (class, not instance)
   * --------------------------------------------------------------------------------
   */

  /**
   * Directory for data related to a Tool (not the instance but the class)
   *
   * Initially, the toolId will be the originalToolActionHash from the tool-library
   *
   * @param toolId Identifier of a Tool (not the instance but the class)
   * @returns
   */
  toolDir(toolId: string): string {
    return path.join(this.toolsDir, toolId);
  }

  /**
   * Assets directories of Tool UIs are cached here for efficiency because they're
   * being used frequently as part of the `cross-group://` custom protocol handler.
   */
  _toolUiAssetsDirCache: Record<string, string> = {};

  /**
   * Clear the cache of Tool UI assets directory paths. This is required after
   * UI updates to make sure that the new UI assets get served through the
   * `cross-group://` custom protocol handler.
   */
  clearToolUiAssetsCache() {
    this._toolUiAssetsDirCache = {};
  }

  /**
   * Directory where the UI assets are to be used for the cross-group view of that
   * Tool.
   *
   * @param toolId
   */
  async toolUiAssetsDir(toolId: string, useCache = true): Promise<string | undefined> {
    const maybeCached = this._toolUiAssetsDirCache[toolId];
    if (maybeCached && useCache) return maybeCached;
    // Iteratively read all applet app asset infos until one is found with
    // the right toolId and if yes, infer the UI asset location from the
    // asset info, add it to the cache and return it.
    // If no matching asset info is found for the given tool id, return undefined.
    const filesAndDirs = await fsPromises.readdir(this.appsDir, { withFileTypes: true });
    for (const fileOrDir of filesAndDirs) {
      if (fileOrDir.isDirectory() && fileOrDir.name.startsWith('applet#')) {
        const assetInfoJsonPath = path.join(this.appsDir, fileOrDir.name, 'info.json');
        if (fs.existsSync(assetInfoJsonPath)) {
          let appAssetsInfoJson: string | undefined;
          try {
            appAssetsInfoJson = await fsPromises.readFile(assetInfoJsonPath, 'utf-8');
          } catch (e) {
            throw new Error(
              `@toolUiAssetsDir: Failed to read app assets info json file at path '${assetInfoJsonPath}': ${e}`,
            );
          }
          try {
            const appAssetsInfo: AppAssetsInfo = JSON.parse(appAssetsInfoJson);
            const toolCompatibilityId = toolCompatibilityIdFromDistInfo(
              appAssetsInfo.distributionInfo,
            );
            if (toolCompatibilityId === toolId && appAssetsInfo.type === 'webhapp') {
              if (appAssetsInfo.ui.location.type === 'filesystem') {
                const uiAssetsDir = path.join(
                  this.uisDir,
                  appAssetsInfo.ui.location.sha256,
                  'assets',
                );
                this._toolUiAssetsDirCache[toolId] = uiAssetsDir;
                return uiAssetsDir;
              }
            }
          } catch (e) {
            throw new Error(`Failed to parse app assets info: ${e}`);
          }
        }
      }
    }
    return undefined;
  }

  toolUserPreferencesPath(toolId: string): string {
    return path.join(this.toolDir(toolId), 'preferences.json');
  }

  toolIconPath(toolId: string): string {
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

  grantCameraAccess(toolId: string): void {
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

  grantMicrophoneAccess(toolId: string): void {
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

  grantFullMediaAccess(toolId: string): void {
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

  /**
   * --------------------------------------------------------------------------------
   * General Utilities
   * --------------------------------------------------------------------------------
   */

  get conductorConfigPath() {
    return path.join(this.conductorDir, 'conductor-config.yaml');
  }

  keystoreInitialized = () => {
    return fs.existsSync(path.join(this.keystoreDir, 'lair-keystore-config.yaml'));
  };

  readOrCreateRandomPassword(): string {
    const pwPath = path.join(this.profileDataDir, '.pw');
    if (!fs.existsSync(pwPath)) {
      const pw = uuidv4();
      fs.writeFileSync(pwPath, pw, 'utf-8');
    }
    return fs.readFileSync(pwPath, 'utf-8');
  }

  randomPasswordExists(): boolean {
    const pwPath = path.join(this.profileDataDir, '.pw');
    return fs.existsSync(pwPath);
  }

  async openLogs() {
    try {
      await shell.openPath(this.profileLogsDir);
    } catch (e) {
      dialog.showErrorBox('Failed to open logs folder', (e as any).toString());
    }
  }

  async exportLogs() {
    try {
      const zip = new AdmZip();
      zip.addLocalFolder(this.profileLogsDir);
      const exportToPathResponse = await dialog.showSaveDialog({
        title: 'Export Logs',
        buttonLabel: 'Export',
        defaultPath: `Moss_${app.getVersion()}_logs_${Date.now()}.zip`,
      });
      if (exportToPathResponse.filePath) {
        zip.writeZip(exportToPathResponse.filePath);
        shell.showItemInFolder(exportToPathResponse.filePath);
      }
    } catch (e) {
      dialog.showErrorBox('Failed to export logs', (e as any).toString());
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

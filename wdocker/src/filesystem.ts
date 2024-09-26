import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import xdg from '@folder/xdg';
import { breakingVersion, decrypt, encrypt, readYamlValue } from './utils.js';
import getFolderSize from 'get-folder-size';
import { HOLOCHAIN_BINARY_NAME, MOSS_CONFIG, PACKAGE_JSON } from './const.js';

export type RunningInfo = {
  daemonPid: number;
  conductorPid: number;
  startedAt: number;
};

export type ConductorRunningInfo = Omit<RunningInfo, 'daemonPid'>;

export type RunningSecretInfo = {
  adminPort: number;
  allowedOrigin: string;
};

export type ConductorRunningStatus = 'running' | 'stopped';

export type ConductorInstanceInfo = {
  id: string;
  status: ConductorRunningStatus;
  /**
   * Timestamp when the conductor has been created initially
   */
  createdAt: number;
  /**
   * Timestamp when the conductor has been started, if it is currently running
   */
  startedAt?: number;
  /**
   * Total size in bytes
   */
  size?: number;
};

export class WDockerFilesystem {
  rootDir: string;
  allConductorsDir: string;
  binsDir: string;
  happsDir: string;

  conductorId: string | undefined;

  breakingVersion: string;

  // TODO pass logger here
  constructor() {
    const versionString = breakingVersion(PACKAGE_JSON.version);
    const dirs = xdg();
    const rootDir = path.join(dirs.data, 'wdocker', versionString);

    const allConductorsDir = path.join(rootDir, 'conductors');
    const binsDir = path.join(rootDir, 'bins');
    const happsDir = path.join(rootDir, 'happs');

    this.rootDir = rootDir;
    this.allConductorsDir = allConductorsDir;
    this.binsDir = binsDir;
    this.happsDir = happsDir;

    createDirIfNotExists(allConductorsDir);
    createDirIfNotExists(binsDir);
    createDirIfNotExists(happsDir);

    this.breakingVersion = versionString;
  }

  setConductorId(conductorId: string) {
    this.conductorId = conductorId;

    createDirIfNotExists(this.conductorDataDir);
    createDirIfNotExists(this.conductorLogsDir);
    createDirIfNotExists(this.conductorEnvDir);
    createDirIfNotExists(this.keystoreDir);
  }

  conductorExists(id: string): boolean {
    return fs.existsSync(path.join(this.allConductorsDir, id));
  }

  get conductorDataDir(): string {
    if (!this.conductorId)
      throw Error(
        'conductorId not set. Use WDockerFilesystem.setConductorId() to set the conductorId.',
      );
    return path.join(this.allConductorsDir, this.conductorId);
  }

  get conductorLogsDir(): string {
    if (!this.conductorId)
      throw Error(
        'conductorId not set. Use WDockerFilesystem.setConductorId() to set the conductorId.',
      );
    return path.join(this.conductorDataDir, 'logs');
  }

  /**
   * The root directory of the actual holochain conductor, containing the
   * conductor-config.yaml file and the holochain databases
   *
   * @param conductorId
   * @returns
   */
  get conductorEnvDir(): string {
    if (!this.conductorId)
      throw Error(
        'conductorId not set. Use WDockerFilesystem.setConductorId() to set the conductorId.',
      );
    return path.join(this.conductorDataDir, 'conductor');
  }

  get keystoreDir(): string {
    if (!this.conductorId)
      throw Error(
        'conductorId not set. Use WDockerFilesystem.setConductorId() to set the conductorId.',
      );
    return path.join(this.conductorDataDir, 'keystore');
  }

  get runningInfoPath() {
    if (!this.conductorId)
      throw Error(
        'conductorId not set. Use WDockerFilesystem.setConductorId() to set the conductorId.',
      );
    return path.join(this.conductorDataDir, '.running');
  }

  get runningSecretInfoPath() {
    if (!this.conductorId)
      throw Error(
        'conductorId not set. Use WDockerFilesystem.setConductorId() to set the conductorId.',
      );
    return path.join(this.conductorDataDir, '.running_s');
  }

  get conductorConfigPath() {
    if (!this.conductorId)
      throw Error(
        'conductorId not set. Use WDockerFilesystem.setConductorId() to set the conductorId.',
      );
    return path.join(this.conductorEnvDir, 'conductor-config.yaml');
  }

  get lairConfigPath() {
    if (!this.conductorId)
      throw Error(
        'conductorId not set. Use WDockerFilesystem.setConductorId() to set the conductorId.',
      );
    return path.join(this.keystoreDir, 'lair-keystore-config.yaml');
  }
  s;

  get holochainBinaryPath() {
    return path.join(this.binsDir, HOLOCHAIN_BINARY_NAME);
  }

  get groupHappPath() {
    return path.join(this.happsDir, `${MOSS_CONFIG.groupHapp.sha256}.happ`);
  }

  get toolsLibraryHappPath() {
    return path.join(this.happsDir, `${MOSS_CONFIG.toolsLibrary.sha256}.happ`);
  }

  happFilePath(sha256: string): string {
    return path.join(this.happsDir, `${sha256}.happ`);
  }

  readLairUrl(): string | undefined {
    if (!this.conductorId)
      throw Error(
        'conductorId not set. Use WDockerFilesystem.setConductorId() to set the conductorId.',
      );
    const lairConfigString = fs.readFileSync(this.lairConfigPath, 'utf-8');
    return readYamlValue(lairConfigString, 'connectionUrl');
  }

  async listConductors(): Promise<Array<ConductorInstanceInfo>> {
    const infos: Array<ConductorInstanceInfo> = [];

    const allConductorsDir = fs.readdirSync(this.allConductorsDir);
    await Promise.all(
      allConductorsDir.map(async (name) => {
        const conductorDataDir = path.join(this.allConductorsDir, name);
        const stats = fs.statSync(conductorDataDir);
        if (stats.isDirectory()) {
          const runningInfoPath = path.join(this.allConductorsDir, name, '.running');
          const isRunning = fs.existsSync(runningInfoPath);
          let startedAt: number | undefined;
          if (isRunning) {
            const runningInfoString = fs.readFileSync(runningInfoPath, 'utf-8');
            const runningInfo: RunningInfo = JSON.parse(runningInfoString);
            startedAt = runningInfo.startedAt;
          }
          const status = isRunning ? 'running' : ('stopped' as ConductorRunningStatus);
          const size = await getFolderSize.loose(conductorDataDir);
          infos.push({
            id: name,
            status,
            createdAt: stats.birthtimeMs,
            startedAt,
            size,
          });
        }
      }),
    );

    return infos;
    // TODO try connect to the conductor to verify that it's running;
    // TODO read actual file to get the size
  }

  storeRunningSecretFile(info: RunningSecretInfo, password: string) {
    // 1. password encrypt info
    const key = crypto.createHash('sha256').update(String(password)).digest('base64').slice(0, 32);
    const encryptedData = encrypt(JSON.stringify(info), key);
    fs.writeFileSync(this.runningSecretInfoPath, encryptedData);
  }

  readRunningSecretFile(password: string): RunningSecretInfo | undefined {
    if (!fs.existsSync(this.runningSecretInfoPath)) return undefined;
    const encryptedData = fs.readFileSync(this.runningSecretInfoPath, 'utf-8');
    const key = crypto.createHash('sha256').update(String(password)).digest('base64').slice(0, 32);
    const decryptedData = decrypt(encryptedData, key);
    return JSON.parse(decryptedData);
  }

  clearRunningSecretFile(): void {
    fs.rmSync(this.runningSecretInfoPath);
  }

  storeRunningFile(info: RunningInfo) {
    fs.writeFileSync(this.runningInfoPath, JSON.stringify(info, undefined, 2));
  }

  readRunningFile(): RunningInfo | undefined {
    if (!fs.existsSync(this.runningInfoPath)) return undefined;
    const infoString = fs.readFileSync(this.runningInfoPath, 'utf-8');
    return JSON.parse(infoString);
  }

  clearRunningFile(): void {
    fs.rmSync(this.runningInfoPath);
  }

  isHappAvailableAndValid(happSha256: string): boolean {
    const happFilePath = this.happFilePath(happSha256);
    if (!fs.existsSync(happFilePath)) {
      return false;
    }
    const happBytes = fs.readFileSync(happFilePath);
    const happHasher = crypto.createHash('sha256');
    const happSha256Actual = happHasher.update(Buffer.from(happBytes)).digest('hex');
    if (happSha256Actual !== happSha256) {
      console.warn(
        `Found corrupted .happ file on disk. Expected sha256: ${happSha256}. Actual sha256: ${happSha256Actual}`,
      );
      return false;
    }
    return true;
  }
}

// wdocker
//  |
//  |-- 0.13.0-beta
//  |   |
//  |   |-- conductors
//  |   |   |
//  |   |   |-- [id1]
//  |   |   |   |
//  |   |   |   |-- logs
//  |   |   |   |
//  |   |   |   |-- conductor
//  |   |   |   |
//  |   |   |   |.running
//  |   |   |   |
//  |   |   |   |.running_s
//  |   |   |
//  |   |   |
//  |   |   |
//  |   |   |-- [id2]
//  |   |
//  |   |
//  |   |
//  |   |-- bins
//  |   |
//  |   |-- happs
//  |
//  |
//  |
//  |-- 0.13.0
//  |
//  |
//  |
// conductors
//
//
//

function createDirIfNotExists(path: fs.PathLike) {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path, { recursive: true });
  }
}

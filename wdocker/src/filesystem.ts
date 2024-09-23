import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import xdg from '@folder/xdg';
import { breakingVersion, decrypt, encrypt } from './utils.js';
import packageJson from './../package.json' assert { type: 'json' };
import { MOSS_CONFIG } from './const.js';

export type RunningInfo = {
  adminPort: number;
  allowedOrigin: string;
  pid: number | undefined;
  startedAt: number;
};

export type ConductorInstanceInfo = {
  id: string;
  createdAt: number;
  status: 'running' | 'stopped' | 'method not implemented';
  /**
   * Total size in bytes
   */
  size: number;
};

const holochainBinaryName = `holochain-v${MOSS_CONFIG.holochain.version}-${MOSS_CONFIG.binariesAppendix}-wdocker${process.platform === 'win32' ? '.exe' : ''}`;

export class WDockerFilesystem {
  rootDir: string;
  allConductorsDir: string;
  binsDir: string;
  happsDir: string;

  conductorId: string | undefined;

  breakingVersion: string;

  // TODO pass logger here
  constructor() {
    const versionString = breakingVersion(packageJson.version);
    const dirs = xdg();
    const rootDir = path.join(dirs.data, 'wdocker', versionString);

    const allConductorsDir = path.join(rootDir, 'conductors');
    const binsDir = path.join(rootDir, 'bins');
    const happsDir = path.join(rootDir, 'happs');

    this.rootDir = rootDir;
    this.allConductorsDir = allConductorsDir;
    this.binsDir = binsDir;
    this.happsDir = happsDir;

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

  get conductorConfigPath() {
    if (!this.conductorId)
      throw Error(
        'conductorId not set. Use WDockerFilesystem.setConductorId() to set the conductorId.',
      );
    return path.join(this.conductorEnvDir, 'conductor-config.yaml');
  }

  get holochainBinaryPath() {
    return path.join(this.binsDir, holochainBinaryName);
  }

  listConductors(): Array<ConductorInstanceInfo> {
    //
    const allConductorsDir = fs.readdirSync(this.allConductorsDir);
    return allConductorsDir
      .map((name) => {
        const stats = fs.statSync(path.join(this.allConductorsDir, name));
        return [
          {
            id: name,
            createdAt: stats.birthtimeMs,
            size: stats.size,
            status: 'method not implemented',
          },
          stats.isDirectory(),
        ];
      })
      .filter((info) => !!info[1])
      .map((info) => info[0] as ConductorInstanceInfo);

    // TODO try connect to the conductor to verify that it's running;
    // TODO read actual file
  }

  storeRunningFile(info: RunningInfo, password: string) {
    // 1. password encrypt info
    const key = crypto.createHash('sha256').update(String(password)).digest('base64').slice(0, 32);
    const encryptedData = encrypt(JSON.stringify(info), key);
    fs.writeFileSync(this.runningInfoPath, encryptedData);
  }

  readRunningFile(password: string): RunningInfo | undefined {
    if (!fs.existsSync(this.runningInfoPath)) return undefined;
    const encryptedData = fs.readFileSync(this.runningInfoPath, 'utf-8');
    const key = crypto.createHash('sha256').update(String(password)).digest('base64').slice(0, 32);
    const decryptedData = decrypt(encryptedData, key);
    return JSON.parse(decryptedData);
  }

  clearRunningFile(): void {
    fs.rmSync(this.runningInfoPath);
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
//  |   |   |   |-- happs
//  |   |   |   |
//  |   |   |   |.running
//  |   |   |
//  |   |   |
//  |   |   |
//  |   |   |-- [id2]
//  |   |
//  |   |
//  |   |
//  |   |-- bins
//  |
//  |-- 0.13.0
//  |
//  |
//  |
//  |
//  |
// conductors
//
//
//
//
// cache
//  |
//  |--happs
//
//
//
//

function createDirIfNotExists(path: fs.PathLike) {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path, { recursive: true });
  }
}

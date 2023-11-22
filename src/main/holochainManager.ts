/* eslint-disable @typescript-eslint/no-var-requires */
import getPort from 'get-port';
import fs from 'fs';
import * as childProcess from 'child_process';
import { HolochainVersion, LauncherEmitter } from './launcherEmitter';
import split from 'split';
import path from 'path';
import { AdminWebsocket, AppInfo } from '@holochain/client';
import { LauncherFileSystem } from './filesystem';

const rustUtils = require('hc-launcher-rust-utils');

export type AdminPort = number;
export type AppPort = number;

export class HolochainManager {
  processHandle: childProcess.ChildProcessWithoutNullStreams;
  adminPort: AdminPort;
  appPort: AppPort;
  adminWebsocket: AdminWebsocket;
  fs: LauncherFileSystem;
  installedApps: AppInfo[];
  launcherEmitter: LauncherEmitter;
  version: HolochainVersion;

  constructor(
    processHandle: childProcess.ChildProcessWithoutNullStreams,
    launcherEmitter: LauncherEmitter,
    launcherFileSystem: LauncherFileSystem,
    adminPort: AdminPort,
    appPort: AppPort,
    adminWebsocket: AdminWebsocket,
    installedApps: AppInfo[],
    version: HolochainVersion,
  ) {
    this.processHandle = processHandle;
    this.launcherEmitter = launcherEmitter;
    this.adminPort = adminPort;
    this.appPort = appPort;
    this.adminWebsocket = adminWebsocket;
    this.fs = launcherFileSystem;
    this.installedApps = installedApps;
    this.version = version;
  }

  static async launch(
    launcherEmitter: LauncherEmitter,
    launcherFileSystem: LauncherFileSystem,
    binary: string,
    version: HolochainVersion,
    rootDir: string,
    configPath: string,
    lairUrl: string,
    bootstrapUrl: string,
    signalingUrl: string,
  ): Promise<HolochainManager> {
    const adminPort = await getPort();

    // TODO Reuse existing config and only overwrite chosen values if necessary
    const conductorConfig = rustUtils.defaultConductorConfig(
      adminPort,
      rootDir,
      lairUrl,
      bootstrapUrl,
      signalingUrl,
    );
    console.log('Writing conductor-config.yaml...');

    fs.writeFileSync(configPath, conductorConfig);

    const conductorHandle = childProcess.spawn(binary, ['-c', configPath, '-p']);
    conductorHandle.stdin.write('abc');
    conductorHandle.stdin.end();
    conductorHandle.stdout.pipe(split()).on('data', async (line: string) => {
      launcherEmitter.emitHolochainLog({
        version,
        data: line,
      });
    });
    conductorHandle.stderr.pipe(split()).on('data', (line: string) => {
      launcherEmitter.emitHolochainError({
        version,
        data: line,
      });
    });

    return new Promise((resolve, reject) => {
      conductorHandle.stdout.pipe(split()).on('data', async (line: string) => {
        if (line.includes('FATAL PANIC PanicInfo')) {
          reject(
            `Holochain version ${version} failed to start up and crashed. Check the logs for details.`,
          );
        }
        if (line.includes('Conductor ready.')) {
          const adminWebsocket = await AdminWebsocket.connect(
            new URL(`ws://localhost:${adminPort}`),
          );
          console.log('Connected to admin websocket.');
          const installedApps = await adminWebsocket.listApps({});
          const appInterfaces = await adminWebsocket.listAppInterfaces();
          console.log('Got appInterfaces: ', appInterfaces);
          let appPort;
          if (appInterfaces.length > 0) {
            appPort = appInterfaces[0];
          } else {
            const attachAppInterfaceResponse = await adminWebsocket.attachAppInterface({});
            console.log('Attached app interface port: ', attachAppInterfaceResponse);
            appPort = attachAppInterfaceResponse.port;
          }
          resolve(
            new HolochainManager(
              conductorHandle,
              launcherEmitter,
              launcherFileSystem,
              adminPort,
              appPort,
              adminWebsocket,
              installedApps,
              version,
            ),
          );
        }
      });
    });
  }

  async installApp(filePath: string, appId: string, networkSeed?: string) {
    const uiTargetDir = path.join(this.fs.uisDir, appId);
    console.log('uiTargetDir: ', uiTargetDir);
    console.log('Installing app...');
    const tempHappPath = await rustUtils.saveWebhapp(filePath, uiTargetDir);
    console.log('Stored UI and got temp happ path: ', tempHappPath);
    const pubKey = await this.adminWebsocket.generateAgentPubKey();
    const appInfo = await this.adminWebsocket.installApp({
      agent_key: pubKey,
      installed_app_id: appId,
      membrane_proofs: {},
      path: tempHappPath,
      network_seed: networkSeed,
    });
    await this.adminWebsocket.enableApp({ installed_app_id: appId });
    console.log('Insalled app.');
    const installedApps = await this.adminWebsocket.listApps({});
    console.log('Installed apps: ', installedApps);
    this.installedApps = installedApps;
    this.launcherEmitter.emitAppInstalled({
      version: this.version,
      data: appInfo,
    });
  }

  async uninstallApp(appId: string) {
    await this.adminWebsocket.uninstallApp({ installed_app_id: appId });
    fs.rmSync(this.fs.appUiDir(appId), { recursive: true });
    console.log('Uninstalled app.');
    const installedApps = await this.adminWebsocket.listApps({});
    console.log('Installed apps: ', installedApps);
    this.installedApps = installedApps;
  }
}

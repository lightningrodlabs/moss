/* eslint-disable @typescript-eslint/no-var-requires */
import getPort from 'get-port';
import fs from 'fs';
import * as childProcess from 'child_process';
import { HolochainVersion, LauncherEmitter } from './launcherEmitter';
import split from 'split';
import { AdminWebsocket, AppInfo } from '@holochain/client';
import { WeFileSystem } from './filesystem';

const rustUtils = require('hc-we-rust-utils');

export type AdminPort = number;
export type AppPort = number;

export class HolochainManager {
  processHandle: childProcess.ChildProcessWithoutNullStreams;
  adminPort: AdminPort;
  appPort: AppPort;
  adminWebsocket: AdminWebsocket;
  fs: WeFileSystem;
  installedApps: AppInfo[];
  launcherEmitter: LauncherEmitter;
  version: HolochainVersion;

  constructor(
    processHandle: childProcess.ChildProcessWithoutNullStreams,
    launcherEmitter: LauncherEmitter,
    launcherFileSystem: WeFileSystem,
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
    launcherFileSystem: WeFileSystem,
    binary: string,
    password: string,
    version: HolochainVersion,
    rootDir: string,
    configPath: string,
    lairUrl: string,
    bootstrapUrl: string,
    signalingUrl: string,
  ): Promise<HolochainManager> {
    const adminPort = process.env.ADMIN_PORT
      ? parseInt(process.env.ADMIN_PORT, 10)
      : await getPort();

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
    console.log('conductorHandle: ', conductorHandle.stdout);
    conductorHandle.stdin.write(password);
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
            new URL(`ws://127.0.0.1:${adminPort}`),
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

  async installWebApp(filePath: string, uiTargetDir: string, appId: string, networkSeed?: string) {
    console.log('uiTargetDir: ', uiTargetDir);
    console.log(`Installing app '${appId}'...`);
    const tempHappPath = await rustUtils.saveHappOrWebhapp(filePath, uiTargetDir);
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
    console.log(`Installed app '${appId}'.`);
    const installedApps = await this.adminWebsocket.listApps({});
    this.installedApps = installedApps;
    this.launcherEmitter.emitAppInstalled({
      version: this.version,
      data: appInfo,
    });
  }

  async installApp(filePath: string, appId: string, networkSeed?: string) {
    console.log(`Installing headless app'${appId}'`);
    const pubKey = await this.adminWebsocket.generateAgentPubKey();
    const appInfo = await this.adminWebsocket.installApp({
      agent_key: pubKey,
      installed_app_id: appId,
      membrane_proofs: {},
      path: filePath,
      network_seed: networkSeed,
    });
    await this.adminWebsocket.enableApp({ installed_app_id: appId });
    const installedApps = await this.adminWebsocket.listApps({});
    this.installedApps = installedApps;
    this.launcherEmitter.emitAppInstalled({
      version: this.version,
      data: appInfo,
    });
  }

  async uninstallApp(appId: string, uiDir: string) {
    await this.adminWebsocket.uninstallApp({ installed_app_id: appId });
    if (uiDir) {
      fs.rmSync(uiDir, { recursive: true });
    }
    console.log(`Uninstalled app '${appId}'.`);
    const installedApps = await this.adminWebsocket.listApps({});
    this.installedApps = installedApps;
  }
}

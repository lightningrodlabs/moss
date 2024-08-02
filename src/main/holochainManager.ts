/* eslint-disable @typescript-eslint/no-var-requires */
import getPort from 'get-port';
import fs from 'fs';
import path from 'path';
import * as childProcess from 'child_process';
import { HolochainVersion, WeEmitter } from './weEmitter';
import split from 'split';
import { AdminWebsocket, AppAuthenticationToken, AppInfo, InstalledAppId } from '@holochain/client';
import { AppAssetsInfo, DistributionInfo, MossFileSystem } from './filesystem';

const rustUtils = require('@lightningrodlabs/we-rust-utils');

export type AdminPort = number;
export type AppPort = number;

export class HolochainManager {
  processHandle: childProcess.ChildProcessWithoutNullStreams;
  adminPort: AdminPort;
  appPort: AppPort;
  adminWebsocket: AdminWebsocket;
  fs: MossFileSystem;
  installedApps: AppInfo[];
  weEmitter: WeEmitter;
  version: HolochainVersion;
  appTokens: Record<InstalledAppId, AppAuthenticationToken> = {};

  constructor(
    processHandle: childProcess.ChildProcessWithoutNullStreams,
    weEmitter: WeEmitter,
    mossFileSystem: MossFileSystem,
    adminPort: AdminPort,
    appPort: AppPort,
    adminWebsocket: AdminWebsocket,
    installedApps: AppInfo[],
    version: HolochainVersion,
  ) {
    this.processHandle = processHandle;
    this.weEmitter = weEmitter;
    this.adminPort = adminPort;
    this.appPort = appPort;
    this.adminWebsocket = adminWebsocket;
    this.fs = mossFileSystem;
    this.installedApps = installedApps;
    this.version = version;
  }

  static async launch(
    weEmitter: WeEmitter,
    mossFileSystem: MossFileSystem,
    binary: string,
    password: string,
    version: HolochainVersion,
    rootDir: string,
    configPath: string,
    lairUrl: string,
    bootstrapUrl: string,
    signalingUrl: string,
    rustLog?: string,
    wasmLog?: string,
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
      '*',
    );
    console.log('Writing conductor-config.yaml...');

    fs.writeFileSync(configPath, conductorConfig);

    // TODO remove after breaking change
    // Rename databases if they have old names
    // ----------------------------------------------------------------------
    const databasesDir = path.join(mossFileSystem.conductorDir, 'databases');
    const p2pDir = path.join(databasesDir, 'p2p');
    if (fs.existsSync(p2pDir)) {
      const p2pDbs = fs.readdirSync(p2pDir);
      p2pDbs.forEach((file) => {
        if (file.startsWith('p2p_')) {
          const newFileName = file.replace('p2p_', '').replace('.sqlite', '');
          fs.renameSync(path.join(p2pDir, file), path.join(p2pDir, newFileName));
        }
      });
    }
    const dhtDir = path.join(databasesDir, 'dht');
    if (fs.existsSync(dhtDir)) {
      const dhtDbs = fs.readdirSync(dhtDir);
      dhtDbs.forEach((file) => {
        if (file.startsWith('dht-')) {
          const newFileName = file.replace('dht-', '').replace('.sqlite', '');
          fs.renameSync(path.join(dhtDir, file), path.join(dhtDir, newFileName));
        }
      });
    }
    const cacheDir = path.join(databasesDir, 'cache');
    if (fs.existsSync(cacheDir)) {
      const cacheDbs = fs.readdirSync(cacheDir);
      cacheDbs.forEach((file) => {
        if (file.startsWith('cache-')) {
          const newFileName = file.replace('cache-', '').replace('.sqlite', '');
          fs.renameSync(path.join(cacheDir, file), path.join(cacheDir, newFileName));
        }
      });
    }
    const authoredDir = path.join(databasesDir, 'authored');
    if (fs.existsSync(authoredDir)) {
      const authoredDbs = fs.readdirSync(authoredDir);
      authoredDbs.forEach((file) => {
        if (file.startsWith('authored-')) {
          const newFileName = file.replace('authored-', '').replace('.sqlite', '');
          fs.renameSync(path.join(authoredDir, file), path.join(authoredDir, newFileName));
        }
      });
    }
    // ----------------------------------------------------------------------

    const conductorHandle = childProcess.spawn(binary, ['-c', configPath, '-p'], {
      env: {
        RUST_LOG: rustLog
          ? rustLog
          : 'warn,' +
            // this thrashes on startup
            'wasmer_compiler_cranelift=error,' +
            // this gives a bunch of warnings about how long db accesses are taking, tmi
            'holochain_sqlite::db::access=error,' +
            // this gives a lot of "search_and_discover_peer_connect: no peers found, retrying after delay" messages on INFO
            'kitsune_p2p::spawn::actor::discover=error',
        WASM_LOG: wasmLog ? wasmLog : 'warn',
        NO_COLOR: '1',
      },
    });
    conductorHandle.stdin.write(password);
    conductorHandle.stdin.end();
    conductorHandle.stdout.pipe(split()).on('data', async (line: string) => {
      weEmitter.emitHolochainLog({
        version,
        data: line,
      });
    });
    conductorHandle.stderr.pipe(split()).on('data', (line: string) => {
      weEmitter.emitHolochainError({
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
          const adminWebsocket = await AdminWebsocket.connect({
            url: new URL(`ws://127.0.0.1:${adminPort}`),
            wsClientOptions: {
              origin: 'moss-admin-main',
            },
          });
          console.log('Connected to admin websocket.');
          const installedApps = await adminWebsocket.listApps({});
          const appInterfaces = await adminWebsocket.listAppInterfaces();
          console.log('Got appInterfaces: ', appInterfaces);
          let appPort;
          if (appInterfaces.length > 0) {
            appPort = appInterfaces[0].port;
          } else {
            const attachAppInterfaceResponse = await adminWebsocket.attachAppInterface({
              allowed_origins: '*',
            });
            console.log('Attached app interface port: ', attachAppInterfaceResponse);
            appPort = attachAppInterfaceResponse.port;
          }
          resolve(
            new HolochainManager(
              conductorHandle,
              weEmitter,
              mossFileSystem,
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

  async installWebApp(
    filePath: string,
    appId: string,
    distributionInfo: DistributionInfo,
    networkSeed?: string,
  ) {
    console.log(`Installing webhapp '${appId}'...`);
    const uisDir = this.fs.uisDir;
    const happsDir = this.fs.happsDir;
    const result: string = await rustUtils.saveHappOrWebhapp(filePath, uisDir, happsDir);
    // webHappHash should only be returned if it is actually a webhapp
    const [happFilePath, happHash, uiHash, webHappHash] = result.split('$');

    if (!webHappHash) throw new Error('Got no webhapp hash.');
    if (!happHash) throw new Error('Got no happ hash.');
    if (!uiHash) throw new Error('Got no UI hash.');

    console.log(
      `Saved webhapp and got hashes:\nhapp: ${happHash}\nui:${uiHash}\nwebhapp: ${webHappHash}`,
    );

    // Use dedicated agent public keys for webhapps (i.e. not Applets)
    const pubKey = await this.adminWebsocket.generateAgentPubKey();
    const appInfo = await this.adminWebsocket.installApp({
      agent_key: pubKey,
      installed_app_id: appId,
      membrane_proofs: {},
      path: happFilePath,
      network_seed: networkSeed,
    });

    // Store app assets info
    const appAssetsInfo: AppAssetsInfo = {
      type: 'webhapp',
      sha256: webHappHash,
      assetSource: {
        type: 'default-app',
      },
      distributionInfo,
      happ: {
        sha256: happHash,
      },
      ui: {
        location: {
          type: 'filesystem',
          sha256: uiHash,
        },
      },
    };

    fs.writeFileSync(
      path.join(this.fs.appsDir, `${appId}.json`),
      JSON.stringify(appAssetsInfo, undefined, 4),
    );

    await this.adminWebsocket.enableApp({ installed_app_id: appId });

    console.log(`Installed app '${appId}'.`);
    const installedApps = await this.adminWebsocket.listApps({});
    this.installedApps = installedApps;
    this.weEmitter.emitAppInstalled({
      version: this.version,
      data: appInfo,
    });
  }

  async installApp(filePath: string, appId: string, networkSeed?: string) {
    console.log(`Installing headless app '${appId}'`);
    const pubKey = await this.adminWebsocket.generateAgentPubKey();
    const appInfo = await this.adminWebsocket.installApp({
      agent_key: pubKey,
      installed_app_id: appId,
      membrane_proofs: {},
      path: filePath,
      network_seed: networkSeed,
    });
    try {
      await this.adminWebsocket.enableApp({ installed_app_id: appId });
      const installedApps = await this.adminWebsocket.listApps({});
      this.installedApps = installedApps;
      this.weEmitter.emitAppInstalled({
        version: this.version,
        data: appInfo,
      });
    } catch (e) {
      throw new Error(
        `Failed to enable appstore: ${e}.\nIf you encounter this in dev mode your local bootstrap server may not be running or at a different port than the one specified.`,
      );
    }
  }

  async getAppToken(appId): Promise<AppAuthenticationToken> {
    const token = this.appTokens[appId];
    if (token) return token;
    const response = await this.adminWebsocket.issueAppAuthenticationToken({
      installed_app_id: appId,
      single_use: false,
      expiry_seconds: 99999999,
    });
    this.appTokens[appId] = response.token;
    return response.token;
  }
}

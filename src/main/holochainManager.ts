/* eslint-disable @typescript-eslint/no-var-requires */
import getPort from 'get-port';
import fs from 'fs';
import yaml from 'js-yaml';
import * as childProcess from 'child_process';
import { HolochainVersion, WeEmitter } from './weEmitter';
import split from 'split';
import { AdminWebsocket, AppAuthenticationToken, AppInfo, InstalledAppId } from '@holochain/client';
import { MossFileSystem } from './filesystem';
import { app } from 'electron';
import { AppAssetsInfo, DistributionInfo } from '@theweave/moss-types';
import { CONDUCTOR_CONFIG_TEMPLATE } from './const';

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
    signalUrl: string,
    iceUrls: Array<string>,
    rustLog?: string,
    wasmLog?: string,
  ): Promise<HolochainManager> {
    const adminPort = process.env.ADMIN_PORT
      ? parseInt(process.env.ADMIN_PORT, 10)
      : await getPort();

    let conductorConfig;

    const allowedOrigins = app.isPackaged
      ? 'moss://admin.main,moss://admin.renderer'
      : 'moss://admin.main,moss://admin.renderer,http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176';

    // Read
    try {
      conductorConfig = yaml.load(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
      console.warn(
        'Failed to read existing conductor-config.yaml file. Overwriting it with a default one.',
      );
      conductorConfig = CONDUCTOR_CONFIG_TEMPLATE;
    }

    conductorConfig.data_root_path = rootDir;
    conductorConfig.keystore.connection_url = lairUrl;
    conductorConfig.admin_interfaces = [
      {
        driver: { type: 'websocket', port: adminPort, allowed_origins: allowedOrigins },
      },
    ];

    // network parameters
    conductorConfig.network.bootstrap_url = bootstrapUrl;
    conductorConfig.network.signal_url = signalUrl;
    conductorConfig.network.webrtc_config = { iceServers: iceUrls.map((url) => ({ urls: [url] })) };

    console.log('Writing conductor-config.yaml...');

    fs.writeFileSync(configPath, yaml.dump(conductorConfig));

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
      conductorHandle.stderr.pipe(split()).on('data', async (line: string) => {
        if (line.includes('holochain had a problem and crashed')) {
          reject(
            `Holochain failed to start up and crashed. Check the logs for details (Help > Open Logs).`,
          );
        }
      });
      conductorHandle.stdout.pipe(split()).on('data', async (line: string) => {
        if (line.includes('could not be parsed, because it is not valid YAML')) {
          reject(
            `Holochain failed to start up and crashed. Check the logs for details (Help > Open Logs).`,
          );
        }
        if (line.includes('Conductor ready.')) {
          const adminWebsocket = await AdminWebsocket.connect({
            url: new URL(`ws://127.0.0.1:${adminPort}`),
            wsClientOptions: {
              origin: 'moss://admin.main',
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
    const { happPath, happSha256, webhappSha256, uiSha256 } = await rustUtils.saveHappOrWebhapp(
      filePath,
      happsDir,
      uisDir,
    );

    if (!webhappSha256) throw new Error('Got no webhapp hash.');
    if (!happSha256) throw new Error('Got no happ hash.');
    if (!uiSha256) throw new Error('Got no UI hash.');

    console.log(
      `Saved webhapp and got hashes:\nhapp: ${happSha256}\nui:${uiSha256}\nwebhapp: ${webhappSha256}`,
    );

    // Use dedicated agent public keys for webhapps (i.e. not Applets)
    const pubKey = await this.adminWebsocket.generateAgentPubKey();
    const appInfo = await this.adminWebsocket.installApp({
      agent_key: pubKey,
      installed_app_id: appId,
      source: {
        type: 'path',
        value: happPath,
      },
      network_seed: networkSeed,
    });

    // Store app assets info
    const appAssetsInfo: AppAssetsInfo = {
      type: 'webhapp',
      sha256: webhappSha256,
      assetSource: {
        type: 'default-app',
      },
      distributionInfo,
      happ: {
        sha256: happSha256,
      },
      ui: {
        location: {
          type: 'filesystem',
          sha256: uiSha256,
        },
      },
    };

    this.fs.storeAppAssetsInfo(appId, appAssetsInfo);

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
      source: {
        type: 'path',
        value: filePath,
      },
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
      expiry_seconds: 0,
    });
    this.appTokens[appId] = response.token;
    return response.token;
  }
}

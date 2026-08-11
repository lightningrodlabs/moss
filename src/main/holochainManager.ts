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
  // Set when the conductor is being deliberately stopped, so its process 'exit'
  // is not mistaken for a crash (see the post-startup exit listener in launch()).
  shuttingDown = false;

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

  /**
   * Deliberately stop the conductor. Marks the stop as intentional first so the
   * process 'exit' is not reported as a crash, then kills the process.
   */
  shutdown(): void {
    this.shuttingDown = true;
    this.processHandle.kill();
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
    relayUrl: string,
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
      // Remove fields from older holochain versions that are no longer recognized
      delete conductorConfig.device_seed_lair_tag;
      delete conductorConfig.danger_generate_throwaway_device_seed;
      delete conductorConfig.dpki;
      delete conductorConfig.request_timeout_s;
      if (conductorConfig.db_sync_strategy) {
        delete conductorConfig.db_sync_strategy;
        conductorConfig.db_sync_level = 'Normal';
      }
      if (conductorConfig.network) {
        delete conductorConfig.network.type;
        delete conductorConfig.network.base64_auth_material;
        delete conductorConfig.network.signal_url;
        delete conductorConfig.network.webrtc_config;
      }
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
    conductorConfig.network.relay_url = relayUrl;

    // In dev mode, we have to allow http:// relay type urls
    if (!app.isPackaged) {
      const advancedSettings = conductorConfig.network.advanced
        ? conductorConfig.network.advanced
        : {};
      advancedSettings['irohTransport'] = {
        relayAllowPlainText: true,
      };
      conductorConfig.network.advanced = advancedSettings;
    }
    const advancedSettings = conductorConfig.network.advanced
      ? conductorConfig.network.advanced
      : {};
    advancedSettings.coreBootstrap = { backoffMaxMs: 30000 };
    advancedSettings.coreSpace = { reSignExpireTimeMs: 30000, reSignFreqMs: 30000 };
    conductorConfig.network.advanced = advancedSettings;

    console.log('Writing conductor-config.yaml...', configPath, conductorConfig);

    fs.writeFileSync(configPath, yaml.dump(conductorConfig));

    const conductorEnv: Record<string, string> = {
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
    };
    // Forward essential env vars for subprocess functionality
    if (process.env.HOME) {
      conductorEnv.HOME = process.env.HOME;
    }
    if (process.env.PATH) {
      conductorEnv.PATH = process.env.PATH;
    }
    // Forward jemalloc profiling config from parent environment.
    // tikv-jemallocator uses _RJEM_ prefix for jemalloc symbols,
    // so the env var is _RJEM_MALLOC_CONF (not MALLOC_CONF).
    if (process.env._RJEM_MALLOC_CONF) {
      conductorEnv._RJEM_MALLOC_CONF = process.env._RJEM_MALLOC_CONF;
    }
    const conductorHandle = childProcess.spawn(binary, ['-c', configPath, '-p'], {
      env: conductorEnv,
    });
    conductorHandle.stdin.write(password);
    conductorHandle.stdin.end();

    // Backstop for a conductor that never prints 'Conductor ready.' and never
    // exits (a true hang). Generous so a slow first-run WASM compile does not
    // trip it; the deterministic failures (crash / bad config / port conflict)
    // are caught by the exit + error listeners below, not by this timer.
    const LAUNCH_TIMEOUT_MS = 300_000;

    return new Promise((resolve, reject) => {
      // A conductor process can fail to spawn ('error'), or exit before
      // 'Conductor ready.' with a message that matches neither magic string
      // below (a lost port race, an incompatible database), or hang without ever
      // becoming ready — all of which must settle this Promise rather than leave
      // the UI waiting at "starting Holochain...". `settled` guards against
      // double-settling; a failed launch also kills the process so it cannot
      // linger holding the admin port and SQLite locks.
      let settled = false;
      const timeout = setTimeout(() => {
        finishErr(
          `Holochain did not become ready within ${LAUNCH_TIMEOUT_MS / 1000}s. Check the logs for details (Help > Open Logs).`,
        );
      }, LAUNCH_TIMEOUT_MS);
      const finishOk = (manager: HolochainManager) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(manager);
      };
      const finishErr = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        conductorHandle.kill();
        reject(message);
      };

      conductorHandle.on('error', (err) => {
        finishErr(`Failed to launch the Holochain conductor process: ${err}`);
      });
      // Only the pre-ready exit is handled here. A post-startup exit is handled
      // by the manager-aware listener attached once launch succeeds (below),
      // which can tell a deliberate shutdown from a crash.
      conductorHandle.on('exit', (code, signal) => {
        if (settled) return;
        finishErr(
          `Holochain conductor exited during startup (code ${code}, signal ${signal}) before becoming ready. Check the logs for details (Help > Open Logs).`,
        );
      });

      conductorHandle.stdout.pipe(split()).on('data', async (line: string) => {
        weEmitter.emitHolochainLog({
          version,
          data: line,
        });
        if (line.includes('could not be parsed, because it is not valid YAML')) {
          finishErr(
            `Holochain failed to start up and crashed. Check the logs for details (Help > Open Logs).`,
          );
        }
        if (line.includes('Conductor ready.')) {
          console.log(
            `[MOSS] Detected 'Conductor ready.' on stdout. Connecting to admin port ${adminPort}...`,
          );
          try {
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
            const manager = new HolochainManager(
              conductorHandle,
              weEmitter,
              mossFileSystem,
              adminPort,
              appPort,
              adminWebsocket,
              installedApps,
              version,
            );
            // Report a crash after a successful startup, but not a deliberate
            // stop (quit / restart / factory reset, which set `shuttingDown`).
            // MOSS_ERROR is used because it has a subscriber (logs.ts); the
            // fatal-panic channel has none, so it would drop the report.
            conductorHandle.on('exit', (code, signal) => {
              if (manager.shuttingDown) return;
              weEmitter.emitMossError(
                `Holochain conductor (v${version}) exited unexpectedly after startup (code ${code}, signal ${signal}).`,
              );
            });
            finishOk(manager);
          } catch (e) {
            finishErr(`Holochain conductor ready but failed to connect: ${e}`);
          }
        }
      });
      conductorHandle.stderr.pipe(split()).on('data', (line: string) => {
        weEmitter.emitHolochainError({
          version,
          data: line,
        });
        if (line.includes('holochain had a problem and crashed')) {
          finishErr(
            `Holochain failed to start up and crashed. Check the logs for details (Help > Open Logs).`,
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

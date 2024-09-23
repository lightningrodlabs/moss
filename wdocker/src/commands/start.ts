/**
 * Starts a new conductor as a detached process and returns the resulting `RunningInfo`
 */

import rustUtils from '@lightningrodlabs/we-rust-utils';
import getPort from 'get-port';
import fs from 'fs';
import split from 'split';
import * as childProcess from 'child_process';

import { RunningInfo, WDockerFilesystem } from '../filesystem.js';
import { AdminWebsocket } from '@holochain/client';
import { PRODUCTION_BOOTSTRAP_URLS, PRODUCTION_SIGNALING_URLS } from '../const.js';
import { nanoid } from 'nanoid';
import { MOSS_CONFIG } from '../const.js';
import { downloadFile } from '../utils.js';

// 0. check already running

// 1. Write conductor config file

// 2.

export async function isConductorRunning(id: string, password): Promise<RunningInfo | undefined> {
  const wDockerFs = new WDockerFilesystem();
  wDockerFs.setConductorId(id);
  const runningInfo = wDockerFs.readRunningFile(password);
  if (runningInfo) {
    // Try to connect to conductor. If successful, return existing running info
    try {
      await AdminWebsocket.connect({
        url: new URL(`ws://localhost:${runningInfo.adminPort}`),
        wsClientOptions: { origin: runningInfo.allowedOrigin },
      });
      return runningInfo;
    } catch (e) {}
  }
  return undefined;
}

export async function startConductor(id: string, password: string): Promise<void> {
  const wDockerFs = new WDockerFilesystem();
  wDockerFs.setConductorId(id);

  const alreadyRunning = fs.existsSync(wDockerFs.runningInfoPath);
  if (alreadyRunning)
    throw new Error('A conductor might already be running with this id. Aborting.');

  // Check whether holochain binary is already present, if not download it.
  if (!fs.existsSync(wDockerFs.holochainBinaryPath)) {
    console.log('No holochain binary found. Downloading from Github...');
    await fetchHolochainBinary(wDockerFs.holochainBinaryPath);
  }

  const conductorEnvDir = wDockerFs.conductorEnvDir;
  const keystoreEnvDir = wDockerFs.keystoreDir;

  const adminPort = await getPort();

  // pick random allowed origin
  const allowedOrigin = nanoid(20);

  const bootstrapUrl = PRODUCTION_BOOTSTRAP_URLS[0];
  const signalingUrl = PRODUCTION_SIGNALING_URLS[0];
  const rustLog = undefined;
  const wasmLog = undefined;

  // Generate conductor config with in-process lair
  const configPath = wDockerFs.conductorConfigPath;
  let conductorConfig: string;

  if (fs.existsSync(configPath)) {
    conductorConfig = rustUtils.overwriteConfig(
      adminPort,
      configPath,
      'unused because we use in-process lair here',
      bootstrapUrl,
      signalingUrl,
      allowedOrigin,
      false,
      undefined,
      keystoreEnvDir,
    );
  } else {
    // TODO Reuse existing config and only overwrite chosen values if necessary
    conductorConfig = rustUtils.defaultConductorConfig(
      adminPort,
      conductorEnvDir,
      'unused because we use in-process lair here',
      bootstrapUrl,
      signalingUrl,
      allowedOrigin,
      false,
      undefined,
      keystoreEnvDir,
    );
  }

  console.log('Writing conductor-config.yaml...');

  fs.writeFileSync(configPath, conductorConfig);

  const conductorHandle = childProcess.spawn(
    wDockerFs.holochainBinaryPath,
    ['-c', configPath, '-p'],
    {
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
      detached: true,
    },
  );
  conductorHandle.stdin.write(password);
  conductorHandle.stdin.end();
  conductorHandle.stdout.pipe(split()).on('data', async (line: string) => {
    console.log('[HOLOCHAIN]: ', line);
    // weEmitter.emitHolochainLog({
    //   version,
    //   data: line,
    // });
  });
  conductorHandle.stderr.pipe(split()).on('data', (line: string) => {
    console.log('[HOLOCHAIN]: ERROR: ', line);
    // weEmitter.emitHolochainError({
    //   version,
    //   data: line,
    // });
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
        console.log('Successfully started conductor.');
        const runningInfo = {
          adminPort,
          allowedOrigin,
          pid: conductorHandle.pid,
          startedAt: Date.now(),
        };
        wDockerFs.storeRunningFile(runningInfo, password);
        resolve();
      }
    });
  });
}

/**
 * Fetches the holochain binary, compares it against the expected hash and gives it executable
 * permission
 *
 * @param dstPath destination path
 */
export async function fetchHolochainBinary(dstPath: string): Promise<void> {
  let targetEnding;
  switch (process.platform) {
    case 'linux':
      targetEnding = 'x86_64-unknown-linux-gnu';
      break;
    case 'win32':
      targetEnding = 'x86_64-pc-windows-msvc.exe';
      break;
    case 'darwin':
      switch (process.arch) {
        case 'arm64':
          targetEnding = 'aarch64-apple-darwin';
          break;
        case 'x64':
          targetEnding = 'x86_64-apple-darwin';
          break;
        default:
          throw new Error(`Got unexpected macOS architecture: ${process.arch}`);
      }
      break;
    default:
      throw new Error(`Got unexpected OS platform: ${process.platform}`);
  }

  const holochainBinaryRemoteFilename = `holochain-v${MOSS_CONFIG.holochain.version}-${targetEnding}`;
  const holochainBinaryUrl = `https://github.com/matthme/holochain-binaries/releases/download/holochain-binaries-${MOSS_CONFIG.holochain.version}/${holochainBinaryRemoteFilename}`;
  return downloadFile(
    holochainBinaryUrl,
    dstPath,
    MOSS_CONFIG.holochain.sha256[targetEnding],
    true,
  );
}

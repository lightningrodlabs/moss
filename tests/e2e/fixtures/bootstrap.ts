import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

/**
 * Locally-running kitsune2-bootstrap-srv that two test agents can talk through.
 *
 * why: the public bootstrap (bootstrap.moss.social) takes minutes to converge
 * for two same-machine agents and is too flaky for a smoke signal. Spinning
 * up a local bootstrap brings cross-agent peer-discovery down to seconds and
 * makes the test deterministic and offline-capable.
 *
 * The binary's stdout contract:
 *   "#kitsune2_bootstrap_srv#listening#<host>:<port>#"  -> we have URLs
 *   "#kitsune2_bootstrap_srv#running#"                  -> ready to serve
 *
 * As of 0.4.0-dev.7 the relay is served at <bootstrap>/relay.
 * (See src/main/cli/devSetup.ts:startLocalServices for the canonical parser.)
 */
export type BootstrapUrls = {
  bootstrapUrl: string;
  signalingUrl: string;
  relayUrl: string;
};

export type RunningBootstrap = BootstrapUrls & {
  proc: ChildProcessWithoutNullStreams;
};

function locateBinary(): string {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const binsDir = path.join(repoRoot, 'resources', 'bins');

  // why: pick the binary version that EXACTLY matches what src/main/const.ts
  // does — `kitsune2BootstrapSrv ?? holochain` from moss.config.json.
  // The repo can carry multiple versions side-by-side during a release bump
  // (e.g. 0.6.1-rc.7 + 0.7.0-dev.22). Picking the wrong one silently mismatches
  // the conductor's kitsune2 protocol — the bootstrap-srv responds 400 to
  // iroh's probe and gossip never initiates, which manifests as the joining
  // agent's installApp hanging silently.
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'moss.config.json'), 'utf-8'));
  const version = config.kitsune2BootstrapSrv ?? config.holochain;
  const platformExt = process.platform === 'win32' ? '.exe' : '';
  const binary = path.join(binsDir, `kitsune2-bootstrap-srv-v${version}${platformExt}`);
  if (!fs.existsSync(binary)) {
    throw new Error(
      `kitsune2-bootstrap-srv binary not found at ${binary}. ` +
        `Run \`yarn fetch:binaries\` first. moss.config.json pins version "${version}".`,
    );
  }
  return binary;
}

/**
 * Spawn the bootstrap server. Resolves once stdout reports "running" and we
 * have parsed the listening host:port. Caller is responsible for `stop()`.
 */
export async function startBootstrap(): Promise<RunningBootstrap> {
  const bin = locateBinary();
  const proc = spawn(bin, [], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (!proc.stdout || !proc.stderr) {
    throw new Error('bootstrap srv: no stdio streams');
  }
  const out = readline.createInterface({ input: proc.stdout });
  const err = readline.createInterface({ input: proc.stderr });
  if (process.env.MOSS_E2E_DEBUG) {
    err.on('line', (l) => process.stderr.write(`[bootstrap-srv:err] ${l}\n`));
    out.on('line', (l) => process.stdout.write(`[bootstrap-srv:out] ${l}\n`));
  }

  return new Promise<RunningBootstrap>((resolve, reject) => {
    let bootstrapUrl: string | undefined;
    let signalingUrl: string | undefined;
    let relayUrl: string | undefined;
    let running = false;

    const timeout = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      reject(new Error('bootstrap srv: did not become ready within 15s'));
    }, 15_000);

    const finishIfReady = () => {
      if (running && bootstrapUrl && signalingUrl && relayUrl) {
        clearTimeout(timeout);
        resolve({ bootstrapUrl, signalingUrl, relayUrl, proc });
      }
    };

    out.on('line', (line) => {
      if (line.includes('#kitsune2_bootstrap_srv#listening#')) {
        const hostAndPort = line.split('#kitsune2_bootstrap_srv#listening#')[1].split('#')[0];
        bootstrapUrl = `http://${hostAndPort}`;
        signalingUrl = `ws://${hostAndPort}`;
        relayUrl = `http://${hostAndPort}/relay`;
      }
      if (line.includes('#kitsune2_bootstrap_srv#running#')) {
        running = true;
      }
      finishIfReady();
    });

    proc.on('exit', (code, sig) => {
      if (!running) {
        clearTimeout(timeout);
        reject(new Error(`bootstrap srv exited before ready (code=${code} signal=${sig})`));
      }
    });
  });
}

export function stopBootstrap(b: RunningBootstrap): void {
  try {
    b.proc.kill('SIGTERM');
  } catch {
    // already gone
  }
}

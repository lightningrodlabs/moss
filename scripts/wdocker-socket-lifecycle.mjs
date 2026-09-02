#!/usr/bin/env node
// Measures whether the wdocker daemon hands back the app websockets it opens
// on every group/tool check cycle.
//
// The unit tests prove `withAppWs` calls close(); they cannot prove the daemon
// reaches that path against a live conductor, because the check cycle only
// opens a socket when the node has at least one enabled group. This harness
// gives it one, shortens the check interval, and counts the daemon's
// established TCP connections across several cycles. A flat count means the
// per-cycle sockets are being closed; a count that climbs by one or more per
// cycle is the leak.
//
// It runs a real conductor and talks to the real network, so it is a
// on-demand check rather than part of any suite.
//
// Usage: node scripts/wdocker-socket-lifecycle.mjs [--cycles N] [--interval S] [--keep]
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const SCRIPT_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(SCRIPT_DIR, '..');
const CLI = path.join(REPO_ROOT, 'wdocker/dist/cli.js');

const CONDUCTOR_ID = 'socket-lifecycle-check';
const PASSWORD = 'socket-lifecycle-check';
const CYCLE_MARKER = 'Checking for new Groups and Tools';
// Logged from inside the withAppWs callback, so it appears only once a
// per-cycle app websocket has actually been opened.
const SOCKET_OPENED_MARKER = 'Checking for Tools to join in group';

function parseArgs() {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i === -1 ? fallback : Number(args[i + 1]);
  };
  return {
    cycles: value('--cycles', 4),
    interval: value('--interval', 15),
    keep: args.includes('--keep'),
  };
}

function cli(args, { capture = true } = {}) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env: { ...process.env, WDOCKER_PASSWORD: PASSWORD, WDOCKER_PURGE_CONFIRM: 'true' },
    stdio: capture ? 'pipe' : 'inherit',
  });
}

/** Run the daemon in the foreground, resolving once it reports a given line. */
function startDaemon(command, waitFor) {
  const child = spawn(process.execPath, [CLI, command, CONDUCTOR_ID], {
    cwd: REPO_ROOT,
    env: { ...process.env, WDOCKER_PASSWORD: PASSWORD },
  });
  const log = [];
  const listeners = [];
  const onLine = (line) => {
    log.push(line);
    for (const listener of listeners) listener(line);
  };
  child.stdout.on('data', (d) => String(d).split('\n').forEach(onLine));
  child.stderr.on('data', (d) => String(d).split('\n').forEach(onLine));

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${waitFor}"`)),
      300_000,
    );
    listeners.push((line) => {
      if (line.includes(waitFor)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  return {
    child,
    ready,
    log,
    onCycle: (fn) => listeners.push((l) => l.includes(CYCLE_MARKER) && fn()),
  };
}

/**
 * Resolve paths through wdocker's own filesystem module rather than restating
 * its layout. `setConductorId` is deliberately not called: it creates the
 * conductor directory, which would defeat the "already exists" guard below.
 */
async function conductorDir() {
  const { WDockerFilesystem } = await import(
    url.pathToFileURL(path.join(REPO_ROOT, 'wdocker/dist/filesystem.js')).href
  );
  return path.join(new WDockerFilesystem().allConductorsDir, CONDUCTOR_ID);
}

async function daemonPid() {
  const running = JSON.parse(fs.readFileSync(path.join(await conductorDir(), '.running'), 'utf-8'));
  return running.daemonPid;
}

/** Established TCP connections owned by a pid, as reported by ss. */
function establishedSockets(pid) {
  const out = execFileSync('ss', ['-tnpH', 'state', 'established'], { encoding: 'utf-8' });
  return out.split('\n').filter((line) => line.includes(`pid=${pid},`)).length;
}

async function setCheckInterval(seconds) {
  const configPath = path.join(await conductorDir(), '._config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.checkForGroupsAndToolsFrequencySeconds = seconds;
  fs.writeFileSync(configPath, JSON.stringify(config, undefined, 2));
}

/**
 * Install and enable a group happ directly, so the daemon's check cycle has a
 * group to open a socket for. Mirrors what `wdocker join-group` installs, with
 * a throwaway network seed and no progenitor, so no invite link is needed.
 */
async function installGroup() {
  const { getAdminWsAndAppPort, downloadGroupHappIfNecessary } = await import(
    url.pathToFileURL(path.join(REPO_ROOT, 'wdocker/dist/helpers/helpers.js')).href
  );
  const { WDockerFilesystem } = await import(
    url.pathToFileURL(path.join(REPO_ROOT, 'wdocker/dist/filesystem.js')).href
  );

  await downloadGroupHappIfNecessary();
  const wDockerFs = new WDockerFilesystem();
  wDockerFs.setConductorId(CONDUCTOR_ID);

  const { adminWs } = await getAdminWsAndAppPort(CONDUCTOR_ID, PASSWORD);
  const networkSeed = `socket-lifecycle-${crypto.randomUUID()}`;
  const hashedSeed = crypto.createHash('sha256').update(networkSeed).digest('base64');
  const appId = `group#${hashedSeed}#null`;
  const agentPubKey = await adminWs.generateAgentPubKey();

  await adminWs.installApp({
    source: { type: 'path', value: wDockerFs.groupHappPath },
    installed_app_id: appId,
    agent_key: agentPubKey,
    network_seed: networkSeed,
    roles_settings: {
      group: { type: 'provisioned', value: { modifiers: { properties: { progenitor: null } } } },
    },
  });
  await adminWs.enableApp({ installed_app_id: appId });
  adminWs.client.close();
  return appId;
}

async function main() {
  const { cycles, interval, keep } = parseArgs();

  if (fs.existsSync(await conductorDir())) {
    console.error(
      `A conductor named '${CONDUCTOR_ID}' already exists. Remove it first:\n  WDOCKER_PASSWORD=${PASSWORD} WDOCKER_PURGE_CONFIRM=true node ${CLI} purge ${CONDUCTOR_ID}`,
    );
    process.exit(1);
  }

  let started;
  try {
    console.log(`Starting conductor '${CONDUCTOR_ID}'...`);
    started = startDaemon('run', 'Daemon ready.');
    await started.ready;

    console.log('Installing a group so the check cycle has something to open a socket for...');
    const appId = await installGroup();
    console.log(`  installed ${appId}`);

    cli(['stop', CONDUCTOR_ID]);
    await setCheckInterval(interval);
    console.log(`Check interval set to ${interval}s; restarting.`);

    started = startDaemon('start', 'Daemon ready.');
    await started.ready;

    const pid = await daemonPid();
    const samples = [];
    console.log(`Daemon pid ${pid}. Sampling established sockets over ${cycles} cycles.`);

    await new Promise((resolve) => {
      started.onCycle(() => {
        // Sample after the cycle has had a moment to open and release sockets.
        setTimeout(() => {
          const count = establishedSockets(pid);
          samples.push(count);
          console.log(`  cycle ${samples.length}: ${count} established sockets`);
          if (samples.length >= cycles) resolve();
        }, 3000);
      });
    });

    // A flat socket count proves nothing unless the cycle actually opened a
    // socket. This line is logged from inside the withAppWs callback, so it
    // only appears once getAppWs has returned a connected websocket.
    const socketCycles = started.log.filter((l) => l.includes(SOCKET_OPENED_MARKER)).length;
    if (socketCycles < samples.length) {
      console.error(
        `INCONCLUSIVE: the daemon reached the per-cycle socket path ${socketCycles} times across ${samples.length} cycles, so a flat count does not show sockets being closed. Check that the group app is installed and enabled.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`Per-cycle socket path was reached in all ${socketCycles} cycles.`);

    const baseline = samples[0];
    const growth = samples[samples.length - 1] - baseline;
    console.log(`\nSamples: ${samples.join(', ')}`);
    if (growth > 0) {
      console.error(
        `LEAK: the daemon's socket count grew by ${growth} across ${cycles} cycles. Per-cycle app websockets are not being closed.`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        `OK: socket count did not grow across ${cycles} cycles — the per-cycle app websockets are being closed.`,
      );
    }
  } finally {
    if (started?.child && !started.child.killed) {
      try {
        cli(['stop', CONDUCTOR_ID]);
      } catch (e) {
        console.error('Failed to stop the conductor:', e.message);
      }
    }
    if (!keep) {
      try {
        cli(['purge', CONDUCTOR_ID]);
        console.log(`Purged '${CONDUCTOR_ID}'.`);
      } catch (e) {
        console.error('Failed to purge the conductor:', e.message);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

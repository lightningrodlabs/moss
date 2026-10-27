import * as childProcess from 'child_process';
import fs from 'fs';
import { ChildRegistry, Leftover, ProcessProbe, findLeftovers } from './childProcessRegistry';

/**
 * Nothing in the OS ties lair or the conductor to the Moss that spawned them: a
 * force-quit, a crash or a kill leaves both running against the profile's
 * keystore and database. The watchdog is a small helper process that holds the
 * read end of a pipe from Moss. The kernel closes that pipe the moment Moss is
 * gone, however it went, so the watchdog needs no polling and no cooperation
 * from the children. It then stops the children Moss last told it about.
 *
 * Moss keeps the registry on disk too (childProcessRegistry.ts): that is the
 * recovery for the cases the watchdog cannot cover, such as a hung Moss or a
 * watchdog that was itself killed.
 */

export interface ReapOptions {
  /** How long to let children finish a shutdown Moss already asked for. */
  graceMs: number;
  pollMs: number;
  sleep: (ms: number) => Promise<void>;
}

export const DEFAULT_GRACE_MS = 3000;
export const DEFAULT_POLL_MS = 200;

/** The recorded children that are still the processes Moss spawned; never Moss itself. */
function liveChildren(registry: ChildRegistry, probe: ProcessProbe, selfPid: number): Leftover[] {
  return findLeftovers(registry, probe, selfPid).filter((l) => l.name !== 'moss');
}

/**
 * Waits for the children to exit on their own, as they do after a normal quit
 * in which Moss stopped them itself, and kills whatever is still running once
 * the grace period is over. Returns what was killed.
 */
export async function reapAfterParentExit(
  registry: ChildRegistry,
  probe: ProcessProbe,
  selfPid: number,
  options: ReapOptions,
): Promise<Leftover[]> {
  const deadline = Date.now() + options.graceMs;
  let remaining = liveChildren(registry, probe, selfPid);
  while (remaining.length > 0 && Date.now() < deadline) {
    await options.sleep(options.pollMs);
    remaining = liveChildren(registry, probe, selfPid);
  }
  for (const child of remaining) {
    probe.kill(child.pid);
  }
  return remaining;
}

export interface ParentWatchdog {
  pid: number | undefined;
  /** Tells the watchdog which processes to stop should Moss disappear. */
  update(registry: ChildRegistry): void;
}

/**
 * Forks the watchdog as a plain Node process from Moss's own binary. It lives
 * in its own process group so a Ctrl-C aimed at Moss does not take it along,
 * and it reads only its stdin: that pipe closing is the signal that Moss died.
 */
export function spawnParentWatchdog(
  script: string,
  logFile: string,
  stderrFile: string,
  onError: (message: string) => void,
): ParentWatchdog {
  // Its stderr is the only trace of a watchdog that fails to start.
  const stderr = fs.openSync(stderrFile, 'w');
  const watchdog = childProcess.fork(script, ['--log', logFile], {
    execArgv: [],
    stdio: ['pipe', 'ignore', stderr, 'ipc'],
    detached: true,
  });
  fs.closeSync(stderr);
  watchdog.unref();
  const stdin = watchdog.stdin!;
  // A watchdog that died early makes every later write fail with EPIPE; the
  // registry on disk still covers the next start, so this is not fatal.
  stdin.on('error', (e) => onError(`Watchdog pipe error: ${e}`));
  watchdog.on('exit', (code, signal) => {
    if (code !== 0) onError(`Watchdog exited early (code ${code}, signal ${signal})`);
  });
  return {
    pid: watchdog.pid,
    update: (registry) => {
      if (stdin.writable) stdin.write(JSON.stringify(registry) + '\n');
    },
  };
}

/**
 * Entry point of the watchdog process (see parentWatchdog.ts). Moss writes its
 * child registry to this process's stdin, one JSON line per change, and never
 * closes the pipe itself: end of input means Moss is gone.
 *
 * Arguments: --log <file> [--grace-ms <n>] [--poll-ms <n>]
 */
import fs from 'fs';
import readline from 'readline';
import { ChildRegistry, parseChildRegistry } from './childProcessRegistry';
import { DEFAULT_GRACE_MS, DEFAULT_POLL_MS, reapAfterParentExit } from './parentWatchdog';
import { systemProbe } from './processProbe';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function numberArg(name: string, fallback: number): number {
  const value = Number(argValue(name));
  return Number.isFinite(value) ? value : fallback;
}

const logFile = argValue('--log');
const graceMs = numberArg('--grace-ms', DEFAULT_GRACE_MS);
const pollMs = numberArg('--poll-ms', DEFAULT_POLL_MS);

/** Same line shape as Moss's own log so the two read as one file. */
function log(message: string): void {
  if (!logFile) return;
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    label: 'MOSS WATCHDOG',
    level: 'info',
    message,
  });
  try {
    fs.appendFileSync(logFile, line + '\n');
  } catch {
    // The log is a courtesy; stopping the children is the job.
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let registry: ChildRegistry | undefined;

const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const parsed = parseChildRegistry(line);
  if (parsed) registry = parsed;
});
lines.on('close', async () => {
  if (!registry) {
    process.exit(0);
  }
  const stopped = await reapAfterParentExit(registry, systemProbe, process.pid, {
    graceMs,
    pollMs,
    sleep,
  });
  if (stopped.length > 0) {
    log(
      `Moss ${registry.mossPid} is gone; stopped ${stopped
        .map((l) => `${l.name} ${l.pid}`)
        .join(', ')}`,
    );
  }
  process.exit(0);
});

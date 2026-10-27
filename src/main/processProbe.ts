import { execFileSync } from 'child_process';
import fs from 'fs';
import { ProcessProbe } from './childProcessRegistry';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but belongs to another user.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function run(file: string, args: string[]): string | undefined {
  try {
    return execFileSync(file, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return undefined;
  }
}

/** Image name or full path of the executable behind `pid`; undefined when the OS will not say. */
function executablePath(pid: number): string | undefined {
  switch (process.platform) {
    case 'linux': {
      try {
        return fs.readlinkSync(`/proc/${pid}/exe`);
      } catch {
        return undefined;
      }
    }
    case 'darwin': {
      const out = run('ps', ['-p', String(pid), '-o', 'comm=']);
      const line = out?.trim();
      return line ? line : undefined;
    }
    case 'win32': {
      // CSV without header: "image","pid","session name","session#","mem"
      const out = run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
      const line = out?.split(/\r?\n/).find((l) => l.startsWith('"'));
      const image = line?.split('","')[0]?.replace(/^"/, '');
      return image ? image : undefined;
    }
    default:
      return undefined;
  }
}

/** Start time of `pid` in epoch ms; undefined when the OS will not say. */
function startTime(pid: number): number | undefined {
  let text: string | undefined;
  switch (process.platform) {
    case 'linux':
    case 'darwin':
      // lstart is the full timestamp; `start` would be truncated to the clock.
      text = run('ps', ['-p', String(pid), '-o', 'lstart='])?.trim();
      break;
    case 'win32':
      text = run('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`,
      ])?.trim();
      break;
    default:
      return undefined;
  }
  if (!text) return undefined;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? undefined : ms;
}

function kill(pid: number): void {
  if (process.platform === 'win32') {
    // No /T: lair and the conductor have no children of their own, and a tree
    // kill would also take any unrelated process whose parent pid matches.
    run('taskkill', ['/PID', String(pid), '/F']);
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

/** The real OS process table. */
export const systemProbe: ProcessProbe = { isAlive, executablePath, startTime, kill };

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

function kill(pid: number): void {
  if (process.platform === 'win32') {
    run('taskkill', ['/PID', String(pid), '/T', '/F']);
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

/** The real OS process table. */
export const systemProbe: ProcessProbe = { isAlive, executablePath, kill };

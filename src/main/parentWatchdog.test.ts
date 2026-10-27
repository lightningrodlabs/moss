import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ChildRegistry, ProcessProbe, parseChildRegistry } from './childProcessRegistry.js';
import { reapAfterParentExit } from './parentWatchdog.js';
import { systemProbe } from './processProbe.js';

const LAIR_BIN = '/opt/moss/bins/lair-keystore-v0.7.1';
const CONDUCTOR_BIN = '/opt/moss/bins/holochain-v0.7.1';
const MOSS_BIN = '/opt/moss/moss';
const T0 = 1_700_000_000_000;

function fakeProbe(alive: Set<number>, exeByPid: Record<number, string>) {
  const killed: number[] = [];
  const probe: ProcessProbe = {
    isAlive: (pid) => alive.has(pid),
    executablePath: (pid) => exeByPid[pid],
    startTime: () => T0,
    kill: (pid) => {
      killed.push(pid);
      alive.delete(pid);
    },
  };
  return { probe, killed };
}

const registry: ChildRegistry = {
  mossPid: 100,
  mossBinary: MOSS_BIN,
  mossStartTime: T0,
  children: [
    { name: 'lair', pid: 200, binary: LAIR_BIN, startTime: T0 },
    { name: 'conductor', pid: 300, binary: CONDUCTOR_BIN, startTime: T0 },
  ],
};

const noWait = async () => {};

describe('reapAfterParentExit', () => {
  it('kills the recorded children that outlived the grace period', async () => {
    const { probe, killed } = fakeProbe(new Set([200, 300]), {
      200: LAIR_BIN,
      300: CONDUCTOR_BIN,
    });
    const stopped = await reapAfterParentExit(registry, probe, 999, {
      graceMs: 1000,
      pollMs: 100,
      sleep: noWait,
    });
    expect(stopped.map((l) => l.pid)).toEqual([200, 300]);
    expect(killed).toEqual([200, 300]);
  });

  it('kills nothing when the children exited on their own within the grace period', async () => {
    const alive = new Set([200, 300]);
    const { probe, killed } = fakeProbe(alive, { 200: LAIR_BIN, 300: CONDUCTOR_BIN });
    let polls = 0;
    const sleep = async () => {
      polls++;
      if (polls === 2) {
        alive.delete(200);
        alive.delete(300);
      }
    };
    const stopped = await reapAfterParentExit(registry, probe, 999, {
      graceMs: 1000,
      pollMs: 100,
      sleep,
    });
    expect(stopped).toEqual([]);
    expect(killed).toEqual([]);
    expect(polls).toBeLessThan(10);
  });

  it('leaves a pid that another program inherited alone', async () => {
    const { probe, killed } = fakeProbe(new Set([200, 300]), {
      200: '/usr/bin/vim',
      300: CONDUCTOR_BIN,
    });
    const stopped = await reapAfterParentExit(registry, probe, 999, {
      graceMs: 0,
      pollMs: 100,
      sleep: noWait,
    });
    expect(stopped.map((l) => l.pid)).toEqual([300]);
    expect(killed).toEqual([300]);
  });

  it('never kills the recorded Moss, even if its pid is alive', async () => {
    const { probe, killed } = fakeProbe(new Set([100]), { 100: MOSS_BIN });
    const stopped = await reapAfterParentExit(registry, probe, 999, {
      graceMs: 0,
      pollMs: 100,
      sleep: noWait,
    });
    expect(stopped).toEqual([]);
    expect(killed).toEqual([]);
  });
});

describe('parseChildRegistry', () => {
  it('accepts one registry per line and rejects anything else', () => {
    expect(parseChildRegistry(JSON.stringify(registry))).toEqual(registry);
    expect(parseChildRegistry('not json')).toBeUndefined();
    expect(parseChildRegistry('{"mossPid":1}')).toBeUndefined();
  });
});

// The entry script is what Moss forks; bundle it the way electron-vite does and
// drive it over its stdin pipe, which is the only signal it listens to.
describe('watchdog entry', () => {
  it('stops the recorded child once its stdin closes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-watchdog-'));
    const script = path.join(dir, 'watchdog.cjs');
    const logFile = path.join(dir, 'we.log');
    execFileSync(
      path.join(process.cwd(), 'node_modules', '.bin', 'esbuild'),
      [
        path.join(process.cwd(), 'src', 'main', 'watchdogMain.ts'),
        '--bundle',
        '--platform=node',
        `--outfile=${script}`,
      ],
      { stdio: 'ignore' },
    );
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'ignore',
    });
    const childExited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
    try {
      const live: ChildRegistry = {
        mossPid: process.pid,
        mossBinary: process.execPath,
        mossStartTime: systemProbe.startTime(process.pid),
        children: [
          {
            name: 'lair',
            pid: child.pid!,
            binary: process.execPath,
            startTime: systemProbe.startTime(child.pid!),
          },
        ],
      };
      const watchdog = spawn(
        process.execPath,
        [script, '--log', logFile, '--grace-ms', '300', '--poll-ms', '50'],
        { stdio: ['pipe', 'ignore', 'ignore'] },
      );
      const watchdogExited = new Promise<number | null>((resolve) =>
        watchdog.on('exit', (code) => resolve(code)),
      );
      watchdog.stdin.write(JSON.stringify(live) + '\n');
      // The child is still wanted: nothing happens while the pipe is open.
      await new Promise((r) => setTimeout(r, 500));
      expect(systemProbe.isAlive(child.pid!)).toBe(true);

      watchdog.stdin.end();
      await Promise.race([childExited, new Promise((r) => setTimeout(r, 5000))]);
      expect(await watchdogExited).toBe(0);
      expect(systemProbe.isAlive(child.pid!)).toBe(false);
      expect(fs.readFileSync(logFile, 'utf-8')).toContain(`stopped lair ${child.pid}`);
    } finally {
      child.kill('SIGKILL');
      await childExited;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});

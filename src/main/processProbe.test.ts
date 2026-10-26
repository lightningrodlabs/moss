import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { systemProbe } from './processProbe.js';
import { findLeftovers, killLeftovers, writeChildRegistry } from './childProcessRegistry.js';

// Runs against the real process table with a throwaway node child, so the
// platform probe is exercised, not only the pure matching logic.
describe('systemProbe', () => {
  it('finds and stops a recorded child that still runs the spawned binary', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'ignore',
    });
    const pid = child.pid!;
    const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-probe-'));
    try {
      expect(systemProbe.isAlive(pid)).toBe(true);
      const reported = systemProbe.executablePath(pid);
      expect(reported).toBeDefined();
      expect(path.basename(reported!).toLowerCase()).toBe(
        path.basename(process.execPath).toLowerCase(),
      );

      const registry = {
        mossPid: process.pid,
        mossBinary: process.execPath,
        children: [
          {
            name: 'lair' as const,
            pid,
            binary: process.execPath,
            startedAt: new Date().toISOString(),
          },
          // Same pid recorded under a different program: must not match.
          {
            name: 'conductor' as const,
            pid,
            binary: '/opt/elsewhere/notepad.exe',
            startedAt: new Date().toISOString(),
          },
        ],
      };
      expect(findLeftovers(registry, systemProbe, process.pid).map((l) => l.pid)).toEqual([pid]);

      writeChildRegistry(dir, registry);
      const stopped = killLeftovers(dir, systemProbe, process.pid);
      expect(stopped.map((l) => l.pid)).toEqual([pid]);
      await exited;
      expect(systemProbe.isAlive(pid)).toBe(false);
    } finally {
      child.kill('SIGKILL');
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a dead pid as not alive and without an executable', () => {
    // pid 2^22 - 1 is above the default Linux pid_max and not allocated on other platforms.
    const unlikely = 4194303;
    expect(systemProbe.isAlive(unlikely)).toBe(false);
    expect(systemProbe.executablePath(unlikely)).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { launchLairKeystore } from './lairKeystore.js';
import { LairFailure } from './lairFailure.js';
import { WeEmitter } from './weEmitter.js';

// Drives launchLairKeystore with a stand-in lair binary (a shell script), so
// the settlement logic runs against a real child process and real pipes.
const unix = process.platform !== 'win32';

function keystoreDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-lair-'));
  fs.writeFileSync(
    path.join(dir, 'lair-keystore-config.yaml'),
    'connectionUrl: unix:///tmp/none/socket?k=abc\n',
  );
  return dir;
}

function fakeLair(dir: string, body: string): string {
  const file = path.join(dir, 'fake-lair.sh');
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

async function failureOf(p: Promise<unknown>): Promise<LairFailure> {
  try {
    await p;
  } catch (e) {
    return e as LairFailure;
  }
  throw new Error('launch resolved');
}

describe.skipIf(!unix)('launchLairKeystore settlement', () => {
  it('classifies an error line even when lair exits right after printing it', async () => {
    const dir = keystoreDir();
    const bin = fakeLair(dir, `echo 'ERROR: Error: {"error":"EIO"}' >&2; exit 1`);
    try {
      // Repeated so an exit-before-stderr race would show up.
      for (let i = 0; i < 15; i++) {
        const failure = await failureOf(launchLairKeystore(bin, dir, new WeEmitter(), 'pw'));
        expect(failure.kind).toBe('keystore-busy');
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects as exited when lair quits without saying anything', async () => {
    const dir = keystoreDir();
    const bin = fakeLair(dir, 'exit 3');
    try {
      const failure = await failureOf(launchLairKeystore(bin, dir, new WeEmitter(), 'pw'));
      expect(failure.kind).toBe('exited');
      expect(failure.detail).toContain('code 3');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves with the connection url and reports the spawned pid', async () => {
    const dir = keystoreDir();
    const bin = fakeLair(
      dir,
      `echo '# lair-keystore connection_url # unix:///x/socket?k=1 #'; sleep 30`,
    );
    const emitter = new WeEmitter();
    const spawned: number[] = [];
    try {
      const [handle, url] = await launchLairKeystore(bin, dir, emitter, 'pw', undefined, (pid) =>
        spawned.push(pid),
      );
      expect(url).toBe('unix:///x/socket?k=1');
      expect(spawned).toEqual([handle.pid]);
    } finally {
      for (const pid of spawned) process.kill(pid, 'SIGKILL');
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

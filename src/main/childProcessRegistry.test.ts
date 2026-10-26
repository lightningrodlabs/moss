import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  CHILD_REGISTRY_FILE,
  ChildRegistry,
  ProcessProbe,
  clearChildRegistry,
  findLeftovers,
  killLeftovers,
  readChildRegistry,
  writeChildRegistry,
} from './childProcessRegistry.js';

const LAIR_BIN = '/opt/moss/bins/lair-keystore-v0.7.1.exe';
const CONDUCTOR_BIN = '/opt/moss/bins/holochain-v0.7.1.exe';
const MOSS_BIN = 'C:\\Program Files\\Moss\\moss.exe';

function fakeProbe(exeByPid: Record<number, string | undefined>, alive: number[]) {
  const killed: number[] = [];
  const probe: ProcessProbe = {
    isAlive: (pid) => alive.includes(pid),
    executablePath: (pid) => exeByPid[pid],
    kill: (pid) => {
      killed.push(pid);
    },
  };
  return { probe, killed };
}

const registry: ChildRegistry = {
  mossPid: 5,
  mossBinary: MOSS_BIN,
  children: [
    { name: 'lair', pid: 10, binary: LAIR_BIN, startedAt: '2026-10-24T17:00:00.000Z' },
    { name: 'conductor', pid: 11, binary: CONDUCTOR_BIN, startedAt: '2026-10-24T17:00:01.000Z' },
    { name: 'conductor', pid: 12, binary: CONDUCTOR_BIN, startedAt: '2026-10-24T17:00:02.000Z' },
  ],
};

describe('childProcessRegistry file', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-registry-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a registry file', () => {
    writeChildRegistry(dir, registry);
    expect(fs.existsSync(path.join(dir, CHILD_REGISTRY_FILE))).toBe(true);
    expect(readChildRegistry(dir)).toEqual(registry);
  });

  it('returns undefined for a missing file', () => {
    expect(readChildRegistry(dir)).toBeUndefined();
  });

  it('returns undefined for malformed JSON or a wrong shape', () => {
    fs.writeFileSync(path.join(dir, CHILD_REGISTRY_FILE), 'not json');
    expect(readChildRegistry(dir)).toBeUndefined();
    fs.writeFileSync(path.join(dir, CHILD_REGISTRY_FILE), '{"nope":1}');
    expect(readChildRegistry(dir)).toBeUndefined();
    fs.writeFileSync(
      path.join(dir, CHILD_REGISTRY_FILE),
      JSON.stringify({ mossPid: 1, mossBinary: 'x', children: [{ pid: 'ten' }] }),
    );
    expect(readChildRegistry(dir)).toBeUndefined();
  });

  it('clearChildRegistry removes the file and tolerates a missing one', () => {
    writeChildRegistry(dir, registry);
    clearChildRegistry(dir);
    expect(fs.existsSync(path.join(dir, CHILD_REGISTRY_FILE))).toBe(false);
    expect(() => clearChildRegistry(dir)).not.toThrow();
  });

  it('killLeftovers kills the matches and deletes the file', () => {
    writeChildRegistry(dir, registry);
    const { probe, killed } = fakeProbe({ 10: LAIR_BIN, 12: '/usr/bin/notepad.exe' }, [10, 12]);
    const result = killLeftovers(dir, probe, 999);
    expect(result.map((l) => l.pid)).toEqual([10]);
    expect(killed).toEqual([10]);
    expect(fs.existsSync(path.join(dir, CHILD_REGISTRY_FILE))).toBe(false);
  });

  it('killLeftovers is a no-op without a registry file', () => {
    const { probe, killed } = fakeProbe({}, []);
    expect(killLeftovers(dir, probe, 999)).toEqual([]);
    expect(killed).toEqual([]);
  });
});

describe('findLeftovers', () => {
  it('keeps only alive pids whose executable matches the spawned binary', () => {
    // pid 10: alive, same image. pid 11: dead. pid 12: alive but reused by another program.
    const { probe } = fakeProbe({ 10: LAIR_BIN, 12: '/usr/bin/notepad.exe' }, [10, 12]);
    expect(findLeftovers(registry, probe, 999)).toEqual([
      { name: 'lair', pid: 10, binary: LAIR_BIN },
    ]);
  });

  it('matches the image name without regard to case or directory', () => {
    const { probe } = fakeProbe({ 10: 'D:\\other\\LAIR-KEYSTORE-V0.7.1.EXE' }, [10]);
    const found = findLeftovers(registry, probe, 999);
    expect(found.map((l) => l.pid)).toEqual([10]);
  });

  it('includes a hung previous moss whose executable matches', () => {
    const { probe } = fakeProbe({ 5: 'C:\\somewhere\\moss.exe' }, [5]);
    expect(findLeftovers(registry, probe, 999)).toEqual([
      { name: 'moss', pid: 5, binary: MOSS_BIN },
    ]);
  });

  it('never returns the current process', () => {
    const { probe } = fakeProbe({ 5: MOSS_BIN }, [5]);
    expect(findLeftovers(registry, probe, 5)).toEqual([]);
  });

  it('skips a pid whose executable cannot be read', () => {
    const { probe } = fakeProbe({ 10: undefined }, [10]);
    expect(findLeftovers(registry, probe, 999)).toEqual([]);
  });
});

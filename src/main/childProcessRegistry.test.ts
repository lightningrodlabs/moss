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
  findLiveOwner,
  killLeftovers,
  readChildRegistry,
  writeChildRegistry,
} from './childProcessRegistry.js';

const LAIR_BIN = '/opt/moss/bins/lair-keystore-v0.7.1.exe';
const CONDUCTOR_BIN = '/opt/moss/bins/holochain-v0.7.1.exe';
const MOSS_BIN = 'C:\\Program Files\\Moss\\moss.exe';

const T0 = 1_700_000_000_000;

function fakeProbe(
  exeByPid: Record<number, string | undefined>,
  alive: number[],
  startByPid: Record<number, number | undefined> = {},
) {
  const killed: number[] = [];
  const probe: ProcessProbe = {
    isAlive: (pid) => alive.includes(pid),
    executablePath: (pid) => exeByPid[pid],
    startTime: (pid) => (pid in startByPid ? startByPid[pid] : T0),
    kill: (pid) => {
      killed.push(pid);
      // The fake process table drops the pid once killed.
      const i = alive.indexOf(pid);
      if (i >= 0) alive.splice(i, 1);
    },
  };
  return { probe, killed };
}

const registry: ChildRegistry = {
  mossPid: 5,
  mossBinary: MOSS_BIN,
  mossStartTime: T0,
  children: [
    { name: 'lair', pid: 10, binary: LAIR_BIN, startTime: T0 },
    { name: 'conductor', pid: 11, binary: CONDUCTOR_BIN, startTime: T0 },
    { name: 'conductor', pid: 12, binary: CONDUCTOR_BIN, startTime: T0 },
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
    // The shape before start times were recorded.
    fs.writeFileSync(
      path.join(dir, CHILD_REGISTRY_FILE),
      JSON.stringify({
        mossPid: 1,
        mossBinary: 'x',
        children: [{ name: 'lair', pid: 2, binary: 'y', startedAt: '2026-01-01T00:00:00Z' }],
      }),
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

  it('killLeftovers keeps the records of processes that survived the kill', () => {
    writeChildRegistry(dir, registry);
    const { probe } = fakeProbe({ 10: LAIR_BIN, 12: CONDUCTOR_BIN }, [10, 12]);
    // pid 12 refuses to die (elevated orphan, access denied).
    probe.kill = () => {};
    const result = killLeftovers(dir, probe, 999);
    expect(result.map((l) => l.pid)).toEqual([10, 12]);
    const remaining = readChildRegistry(dir);
    expect(remaining?.children.map((c) => c.pid)).toEqual([10, 12]);
  });

  it('killLeftovers leaves a live owner and its children alone unless told to stop the owner', () => {
    writeChildRegistry(dir, registry);
    const { probe, killed } = fakeProbe({ 5: MOSS_BIN, 10: LAIR_BIN }, [5, 10]);
    expect(killLeftovers(dir, probe, 999, { stopLiveOwner: false })).toEqual([]);
    expect(killed).toEqual([]);
    expect(readChildRegistry(dir)).toBeDefined();
    expect(killLeftovers(dir, probe, 999, { stopLiveOwner: true }).map((l) => l.pid)).toEqual([
      5, 10,
    ]);
  });
});

describe('findLiveOwner', () => {
  it('returns the recorded moss when it is still that very process', () => {
    const { probe } = fakeProbe({ 5: MOSS_BIN }, [5]);
    expect(findLiveOwner(registry, probe, 999)).toEqual({ name: 'moss', pid: 5, binary: MOSS_BIN });
  });

  it('returns undefined for a dead, reused or own pid', () => {
    expect(findLiveOwner(registry, fakeProbe({}, []).probe, 999)).toBeUndefined();
    expect(
      findLiveOwner(registry, fakeProbe({ 5: MOSS_BIN }, [5], { 5: T0 + 99_000 }).probe, 999),
    ).toBeUndefined();
    expect(findLiveOwner(registry, fakeProbe({ 5: MOSS_BIN }, [5]).probe, 5)).toBeUndefined();
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

  it('skips a pid reused by the same binary started at another time (another profile)', () => {
    // Same image, but this process started 5 s later than the one we recorded.
    const { probe } = fakeProbe({ 10: LAIR_BIN, 5: MOSS_BIN }, [10, 5], {
      10: T0 + 5000,
      5: T0 + 60_000,
    });
    expect(findLeftovers(registry, probe, 999)).toEqual([]);
  });

  it('accepts a start time within clock-tick tolerance', () => {
    const { probe } = fakeProbe({ 10: LAIR_BIN }, [10], { 10: T0 + 900 });
    expect(findLeftovers(registry, probe, 999).map((l) => l.pid)).toEqual([10]);
  });

  it('refuses to kill when the live start time is unknown but one was recorded', () => {
    const { probe } = fakeProbe({ 10: LAIR_BIN }, [10], { 10: undefined });
    expect(findLeftovers(registry, probe, 999)).toEqual([]);
  });

  it('falls back to the image check when no start time was recorded', () => {
    const legacy: ChildRegistry = {
      ...registry,
      children: [{ name: 'lair', pid: 10, binary: LAIR_BIN }],
    };
    const { probe } = fakeProbe({ 10: LAIR_BIN }, [10], { 10: T0 + 99_000 });
    expect(findLeftovers(legacy, probe, 999).map((l) => l.pid)).toEqual([10]);
  });

  it('matches a Linux executable that was replaced on disk', () => {
    const { probe } = fakeProbe({ 10: `${LAIR_BIN} (deleted)` }, [10]);
    expect(findLeftovers(registry, probe, 999).map((l) => l.pid)).toEqual([10]);
  });
});

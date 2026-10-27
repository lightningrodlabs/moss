import fs from 'fs';
import path from 'path';

/**
 * Per-profile record of the subprocesses Moss spawned, so that a later start of
 * the same profile can stop whatever an earlier session left behind. Lair's own
 * pid check cannot do this because it looks for a process named `lair_keystore`
 * while Moss ships the binary under a versioned name.
 *
 * Everything here is keyed on one profile's data directory. Other profiles and
 * other apps keep their own keystores, pipes and pid files and are never touched.
 */

export type ChildName = 'lair' | 'conductor';

export interface ChildRecord {
  name: ChildName;
  pid: number;
  /** Absolute path Moss spawned. */
  binary: string;
  /**
   * Process start time (epoch ms) as the OS reported it right after spawn.
   * Together with the pid it identifies one process, so a pid the OS later
   * handed to another program (or another Moss profile) is never matched.
   * Absent when the OS would not say.
   */
  startTime?: number;
}

export interface ChildRegistry {
  mossPid: number;
  /** `process.execPath` at write time. */
  mossBinary: string;
  mossStartTime?: number;
  children: ChildRecord[];
}

export const CHILD_REGISTRY_FILE = 'moss-children.json';

/** The minimal view of the OS process table the registry needs; injectable for tests. */
export interface ProcessProbe {
  isAlive(pid: number): boolean;
  /** Path (or at least file name) of the executable behind `pid`, or undefined if unknown. */
  executablePath(pid: number): string | undefined;
  /** Start time of `pid` in epoch ms, or undefined if unknown. */
  startTime(pid: number): number | undefined;
  kill(pid: number): void;
}

/** OS clocks report start times in ticks or whole seconds, so allow a second either way. */
const START_TIME_TOLERANCE_MS = 1500;

export interface Leftover {
  name: ChildName | 'moss';
  pid: number;
  binary: string;
}

function registryPath(profileDataDir: string): string {
  return path.join(profileDataDir, CHILD_REGISTRY_FILE);
}

function isChildRecord(value: unknown): value is ChildRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.name === 'lair' || v.name === 'conductor') &&
    typeof v.pid === 'number' &&
    typeof v.binary === 'string' &&
    (v.startTime === undefined || typeof v.startTime === 'number') &&
    !('startedAt' in v)
  );
}

function isChildRegistry(value: unknown): value is ChildRegistry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.mossPid === 'number' &&
    typeof v.mossBinary === 'string' &&
    (v.mossStartTime === undefined || typeof v.mossStartTime === 'number') &&
    Array.isArray(v.children) &&
    v.children.every(isChildRecord)
  );
}

/** Returns undefined for malformed or differently shaped text. */
export function parseChildRegistry(text: string): ChildRegistry | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  return isChildRegistry(parsed) ? parsed : undefined;
}

/** Returns undefined for a missing, unreadable, malformed or differently shaped file. */
export function readChildRegistry(profileDataDir: string): ChildRegistry | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(registryPath(profileDataDir), 'utf-8');
  } catch {
    return undefined;
  }
  return parseChildRegistry(raw);
}

export function writeChildRegistry(profileDataDir: string, registry: ChildRegistry): void {
  fs.writeFileSync(registryPath(profileDataDir), JSON.stringify(registry, null, 2), 'utf-8');
}

export function clearChildRegistry(profileDataDir: string): void {
  fs.rmSync(registryPath(profileDataDir), { force: true });
}

/**
 * Matches on the executable file name only, ignoring case. The spawned path and
 * the path the OS reports can differ in directory (install location moved,
 * 8.3 names, symlinks), but a reused pid belongs to a different program.
 */
function sameImage(spawnedBinary: string, reportedPath: string): boolean {
  // Linux reports a replaced executable as "<path> (deleted)"; it is still ours.
  const reported = reportedPath.replace(/ \(deleted\)$/, '');
  // win32.basename splits on both separators, so it is right on every platform.
  return (
    path.win32.basename(spawnedBinary).toLowerCase() === path.win32.basename(reported).toLowerCase()
  );
}

/**
 * True only for the very process that was recorded. Every Moss profile runs the
 * same binaries, so the image name alone cannot tell a leftover from another
 * profile's live process that inherited the pid; the start time can. When a
 * start time was recorded but the OS will not report one now, err on the side
 * of not killing.
 */
function isSameProcess(
  pid: number,
  binary: string,
  startTime: number | undefined,
  probe: ProcessProbe,
  selfPid: number,
): boolean {
  if (pid === selfPid) return false;
  if (!probe.isAlive(pid)) return false;
  const reported = probe.executablePath(pid);
  if (reported === undefined || !sameImage(binary, reported)) return false;
  if (startTime === undefined) return true;
  const liveStart = probe.startTime(pid);
  return liveStart !== undefined && Math.abs(liveStart - startTime) <= START_TIME_TOLERANCE_MS;
}

/**
 * The recorded processes that are still running the binary Moss started them
 * with. A previous Moss that hung on quit counts too, since it holds a client
 * handle to the keystore pipe.
 */
export function findLeftovers(
  registry: ChildRegistry,
  probe: ProcessProbe,
  selfPid: number,
): Leftover[] {
  const found: Leftover[] = [];
  if (
    isSameProcess(registry.mossPid, registry.mossBinary, registry.mossStartTime, probe, selfPid)
  ) {
    found.push({ name: 'moss', pid: registry.mossPid, binary: registry.mossBinary });
  }
  for (const child of registry.children) {
    if (isSameProcess(child.pid, child.binary, child.startTime, probe, selfPid)) {
      found.push({ name: child.name, pid: child.pid, binary: child.binary });
    }
  }
  return found;
}

/** The recorded Moss, if it is still the very process that wrote the registry. */
export function findLiveOwner(
  registry: ChildRegistry,
  probe: ProcessProbe,
  selfPid: number,
): Leftover | undefined {
  return findLeftovers(registry, probe, selfPid).find((l) => l.name === 'moss');
}

export interface KillLeftoversOptions {
  /**
   * Whether a recorded Moss that is still running counts as a leftover. A
   * packaged Moss holds the per-profile single-instance lock, so a live owner
   * can only be a hung previous instance. Without the lock (dev builds) it is
   * more likely a healthy instance the user started twice, and its children
   * must be left alone too.
   */
  stopLiveOwner: boolean;
}

/**
 * Stops the leftovers of this profile and returns what was signalled. Records
 * whose process survived the kill stay in the registry so a later attempt (the
 * splash-screen button, the next start) can try again; the file is dropped
 * once nothing recorded is alive.
 */
export function killLeftovers(
  profileDataDir: string,
  probe: ProcessProbe,
  selfPid: number,
  options: KillLeftoversOptions = { stopLiveOwner: true },
): Leftover[] {
  const registry = readChildRegistry(profileDataDir);
  if (!registry) return [];
  const leftovers = findLeftovers(registry, probe, selfPid);
  if (!options.stopLiveOwner && leftovers.some((l) => l.name === 'moss')) {
    return [];
  }
  for (const leftover of leftovers) {
    probe.kill(leftover.pid);
  }
  const survivors = findLeftovers(registry, probe, selfPid);
  if (survivors.length === 0) {
    clearChildRegistry(profileDataDir);
  } else {
    const survivorPids = new Set(survivors.map((s) => s.pid));
    writeChildRegistry(profileDataDir, {
      ...registry,
      children: registry.children.filter((c) => survivorPids.has(c.pid)),
    });
  }
  return leftovers;
}

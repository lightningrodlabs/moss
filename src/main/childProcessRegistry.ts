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
  /** ISO 8601. */
  startedAt: string;
}

export interface ChildRegistry {
  mossPid: number;
  /** `process.execPath` at write time. */
  mossBinary: string;
  children: ChildRecord[];
}

export const CHILD_REGISTRY_FILE = 'moss-children.json';

/** The minimal view of the OS process table the registry needs; injectable for tests. */
export interface ProcessProbe {
  isAlive(pid: number): boolean;
  /** Path (or at least file name) of the executable behind `pid`, or undefined if unknown. */
  executablePath(pid: number): string | undefined;
  kill(pid: number): void;
}

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
    typeof v.startedAt === 'string'
  );
}

function isChildRegistry(value: unknown): value is ChildRegistry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.mossPid === 'number' &&
    typeof v.mossBinary === 'string' &&
    Array.isArray(v.children) &&
    v.children.every(isChildRecord)
  );
}

/** Returns undefined for a missing, unreadable, malformed or differently shaped file. */
export function readChildRegistry(profileDataDir: string): ChildRegistry | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(registryPath(profileDataDir), 'utf-8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return isChildRegistry(parsed) ? parsed : undefined;
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
  // win32.basename splits on both separators, so it is right on every platform.
  return (
    path.win32.basename(spawnedBinary).toLowerCase() ===
    path.win32.basename(reportedPath).toLowerCase()
  );
}

function isLeftover(pid: number, binary: string, probe: ProcessProbe, selfPid: number): boolean {
  if (pid === selfPid) return false;
  if (!probe.isAlive(pid)) return false;
  const reported = probe.executablePath(pid);
  return reported !== undefined && sameImage(binary, reported);
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
  if (isLeftover(registry.mossPid, registry.mossBinary, probe, selfPid)) {
    found.push({ name: 'moss', pid: registry.mossPid, binary: registry.mossBinary });
  }
  for (const child of registry.children) {
    if (isLeftover(child.pid, child.binary, probe, selfPid)) {
      found.push({ name: child.name, pid: child.pid, binary: child.binary });
    }
  }
  return found;
}

/** Stops the leftovers of this profile, drops the registry file, and returns what was stopped. */
export function killLeftovers(
  profileDataDir: string,
  probe: ProcessProbe,
  selfPid: number,
): Leftover[] {
  const registry = readChildRegistry(profileDataDir);
  if (!registry) return [];
  const leftovers = findLeftovers(registry, probe, selfPid);
  for (const leftover of leftovers) {
    probe.kill(leftover.pid);
  }
  clearChildRegistry(profileDataDir);
  return leftovers;
}

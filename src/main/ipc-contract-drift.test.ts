import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * IPC contract drift guard.
 *
 * The renderer↔main IPC surface is maintained by hand in two places: the preload
 * bridges (`ipcRenderer.invoke('channel', ...)`) and the main handlers
 * (`ipcMain.handle('channel', ...)`), with nothing linking them. This test makes
 * a mismatch a failing build in either direction:
 *   - every channel a preload bridge invokes must have a main handler (a missing
 *     one rejects at runtime with "No handler registered"), and
 *   - every main handler must be reachable from a preload bridge.
 *
 * Both are literal-string scans; a channel built from a variable would be
 * invisible here — keep channel names as string literals at the call site.
 */

const REPO_ROOT = process.cwd();
const PRELOAD_DIR = path.join(REPO_ROOT, 'src', 'preload');
const MAIN_DIR = path.join(REPO_ROOT, 'src', 'main');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(p));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

function channels(files: string[], callPattern: RegExp): Set<string> {
  const found = new Set<string>();
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(callPattern)) found.add(m[1]);
  }
  return found;
}

const invoked = channels(tsFiles(PRELOAD_DIR), /ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g);
const handled = channels(tsFiles(MAIN_DIR), /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g);

describe('IPC contract (preload ↔ main)', () => {
  it('every preload-invoked channel has a main handler', () => {
    const dead = [...invoked].filter((c) => !handled.has(c)).sort();
    expect(dead, `preload channels with no ipcMain.handle: ${dead.join(', ')}`).toEqual([]);
  });

  it('every main handler is reachable from a preload bridge', () => {
    const orphans = [...handled].filter((c) => !invoked.has(c)).sort();
    expect(
      orphans,
      `ipcMain.handle channels never invoked from preload: ${orphans.join(', ')}`,
    ).toEqual([]);
  });

  it('found a plausible number of channels (guards against the scan silently matching nothing)', () => {
    expect(invoked.size).toBeGreaterThan(50);
    expect(handled.size).toBeGreaterThan(50);
  });
});

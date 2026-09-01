import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * App websocket construction guard.
 *
 * `@theweave/utils` exports `createAppWebsocket`, which applies the sticky
 * auth-token patch that keeps a long-lived connection recoverable after a
 * transient reconnect. A bare `AppWebsocket.connect` silently opts out of it,
 * and the daemon's sockets live for the uptime of the node. Keep construction
 * in one place so the patch cannot be skipped by accident.
 */
const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELPERS = path.join(SRC_DIR, 'helpers', 'helpers.ts');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(p));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('app websocket construction', () => {
  it('builds every app websocket through createAppWebsocket', () => {
    const helpers = fs.readFileSync(HELPERS, 'utf8');
    expect(helpers).toContain('createAppWebsocket');
  });

  it('has no direct AppWebsocket.connect call outside helpers.ts', () => {
    const offenders = tsFiles(SRC_DIR)
      .filter((file) => file !== HELPERS)
      .filter((file) => /AppWebsocket\.connect\s*\(/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC_DIR, file));
    expect(offenders).toEqual([]);
  });
});

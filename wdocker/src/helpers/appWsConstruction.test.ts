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

/**
 * Reduce a source file to the code the compiler sees, so prose that names a
 * construction can neither satisfy nor trip the assertions below.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('app websocket construction', () => {
  it('builds its app websocket by calling createAppWebsocket', () => {
    const helpers = stripComments(fs.readFileSync(HELPERS, 'utf8'));
    expect(helpers).toMatch(/return createAppWebsocket\(/);
  });

  it('has no direct AppWebsocket.connect call anywhere in wdocker/src', () => {
    const offenders = tsFiles(SRC_DIR)
      .filter((file) =>
        /AppWebsocket\.connect\s*\(/.test(stripComments(fs.readFileSync(file, 'utf8'))),
      )
      .map((file) => path.relative(SRC_DIR, file));
    expect(offenders).toEqual([]);
  });
});

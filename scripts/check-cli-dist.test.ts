import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(__dirname, 'check-cli-dist.mjs');

function runChecker(root: string): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [SCRIPT, root], { encoding: 'utf-8' });
    return { status: 0, output };
  } catch (e: any) {
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function requiredFiles(): string[] {
  const output = execFileSync(process.execPath, [SCRIPT, '--print-required'], {
    encoding: 'utf-8',
  });
  return output.trim().split('\n');
}

function makeTree(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-dist-check-'));
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'x');
  }
  return root;
}

describe('check-cli-dist', () => {
  it('lists the files the published package must contain', () => {
    const required = requiredFiles();
    // The files whose absence broke the 0.16.0-dev.4 publish must be guarded.
    expect(required).toContain('dist/happ-iframe/index.mjs');
    expect(required).toContain('dist/applet-iframe/index.mjs');
    expect(required).toContain('dist/main/resources/default-apps/group.happ');
  });

  it('passes when every required file is present', () => {
    const root = makeTree(requiredFiles());
    const result = runChecker(root);
    expect(result.status).toBe(0);
  });

  it('fails and names each missing file', () => {
    const required = requiredFiles();
    const missing = ['dist/happ-iframe/index.mjs', 'dist/main/resources/default-apps/group.happ'];
    const root = makeTree(required.filter((f) => !missing.includes(f)));
    const result = runChecker(root);
    expect(result.status).toBe(1);
    for (const file of missing) {
      expect(result.output).toContain(file);
    }
  });
});

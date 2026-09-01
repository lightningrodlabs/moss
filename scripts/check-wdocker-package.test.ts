import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(__dirname, 'check-wdocker-package.mjs');

const GOOD_DEPS = {
  '@theweave/api': '^0.7.0-dev.2',
  '@theweave/group-client': '0.7.0-dev.1',
  '@theweave/moss-types': '0.7.0-dev.1',
  '@theweave/utils': '0.7.0-dev.1',
};

const MOSS_CONFIG = { holochain: '0.7.0', binariesAppendix: 'moss-0.16' };

function run(pkgDir: string, referenceConfig: string): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [SCRIPT, pkgDir, referenceConfig], {
      encoding: 'utf-8',
    });
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

/**
 * Build a throwaway wdocker package tree. `overrides` patch the package.json;
 * `omit` drops dist files that would otherwise be present.
 */
function makePackage(
  overrides: Record<string, unknown> = {},
  omit: string[] = [],
  distMossConfig: unknown = MOSS_CONFIG,
): { pkgDir: string; referenceConfig: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdocker-pkg-check-'));
  const pkgDir = path.join(root, 'wdocker');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: '@theweave/wdocker', dependencies: GOOD_DEPS, ...overrides }),
  );
  for (const file of requiredFiles()) {
    if (omit.includes(file)) continue;
    fs.mkdirSync(path.dirname(path.join(pkgDir, file)), { recursive: true });
    const contents = file.endsWith('moss.config.json') ? JSON.stringify(distMossConfig) : 'x';
    fs.writeFileSync(path.join(pkgDir, file), contents);
  }
  const referenceConfig = path.join(root, 'moss.config.json');
  fs.writeFileSync(referenceConfig, JSON.stringify(MOSS_CONFIG));
  return { pkgDir, referenceConfig };
}

describe('check-wdocker-package', () => {
  it('requires the runtime files the CLI reads at module load', () => {
    const required = requiredFiles();
    expect(required).toContain('dist/cli.js');
    expect(required).toContain('dist/daemon/daemon.js');
    expect(required).toContain('dist/moss.config.json');
    expect(required).toContain('dist/holochain-checksums.json');
    expect(required).toContain('dist/conductor-config.yaml');
  });

  it('passes a complete, correctly declared package', () => {
    const { pkgDir, referenceConfig } = makePackage();
    const result = run(pkgDir, referenceConfig);
    expect(result.status).toBe(0);
  });

  it('rejects file: dependency specs', () => {
    const { pkgDir, referenceConfig } = makePackage({
      dependencies: { ...GOOD_DEPS, '@theweave/utils': 'file:../shared/utils' },
    });
    const result = run(pkgDir, referenceConfig);
    expect(result.status).toBe(1);
    expect(result.output).toContain('@theweave/utils');
    expect(result.output).toContain('file:');
  });

  it('rejects a missing @theweave dependency declaration', () => {
    const deps: Record<string, string> = { ...GOOD_DEPS };
    delete deps['@theweave/moss-types'];
    const { pkgDir, referenceConfig } = makePackage({ dependencies: deps });
    const result = run(pkgDir, referenceConfig);
    expect(result.status).toBe(1);
    expect(result.output).toContain('@theweave/moss-types');
  });

  it('names each missing dist file', () => {
    const { pkgDir, referenceConfig } = makePackage({}, ['dist/conductor-config.yaml']);
    const result = run(pkgDir, referenceConfig);
    expect(result.status).toBe(1);
    expect(result.output).toContain('dist/conductor-config.yaml');
  });

  it('rejects a dist/moss.config.json that drifted from the repo root', () => {
    const { pkgDir, referenceConfig } = makePackage({}, [], {
      holochain: '0.6.1-rc.1',
      binariesAppendix: 'moss-0.15',
    });
    const result = run(pkgDir, referenceConfig);
    expect(result.status).toBe(1);
    expect(result.output).toContain('0.6.1-rc.1');
    expect(result.output).toContain('0.7.0');
  });
});

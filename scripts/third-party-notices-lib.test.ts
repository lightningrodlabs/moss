import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  BUNDLED_BINARIES,
  collectPackages,
  findLicenseText,
  licenseOf,
  renderNotices,
  repositoryUrl,
} from './third-party-notices-lib.mjs';

let root: string;

function writePkg(dir: string, pkg: Record<string, unknown>, files: Record<string, string> = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'notices-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('licenseOf', () => {
  it('reads the SPDX license field', () => {
    expect(licenseOf({ license: 'MIT' })).toBe('MIT');
  });

  it('reads the legacy object and array forms', () => {
    expect(licenseOf({ license: { type: 'ISC' } })).toBe('ISC');
    expect(licenseOf({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe(
      'MIT OR Apache-2.0',
    );
  });

  it('reports UNKNOWN when nothing is declared', () => {
    expect(licenseOf({})).toBe('UNKNOWN');
  });
});

describe('repositoryUrl', () => {
  it('normalizes the common repository field forms to a browsable https URL', () => {
    expect(repositoryUrl({ repository: 'github:user/repo' })).toBe('https://github.com/user/repo');
    expect(repositoryUrl({ repository: 'user/repo' })).toBe('https://github.com/user/repo');
    expect(
      repositoryUrl({ repository: { type: 'git', url: 'git+https://github.com/user/repo.git' } }),
    ).toBe('https://github.com/user/repo');
    expect(repositoryUrl({ repository: 'git://github.com/user/repo.git' })).toBe(
      'https://github.com/user/repo',
    );
    expect(repositoryUrl({ repository: 'git@github.com:user/repo.git' })).toBe(
      'https://github.com/user/repo',
    );
  });

  it('falls back to homepage and omits non-http values', () => {
    expect(repositoryUrl({ homepage: 'https://example.com' })).toBe('https://example.com');
    expect(repositoryUrl({ repository: 'file:../x' })).toBeUndefined();
    expect(repositoryUrl({})).toBeUndefined();
  });
});

describe('findLicenseText', () => {
  it('finds LICENSE, LICENCE and COPYING files in any case and extension', () => {
    writePkg(path.join(root, 'a'), {}, { 'license.md': 'A text' });
    writePkg(path.join(root, 'b'), {}, { LICENCE: 'B text' });
    writePkg(path.join(root, 'c'), {}, { 'COPYING.txt': 'C text' });
    expect(findLicenseText(path.join(root, 'a'))).toBe('A text');
    expect(findLicenseText(path.join(root, 'b'))).toBe('B text');
    expect(findLicenseText(path.join(root, 'c'))).toBe('C text');
  });

  it('returns undefined when the package ships no license file', () => {
    writePkg(path.join(root, 'd'), {});
    expect(findLicenseText(path.join(root, 'd'))).toBeUndefined();
  });
});

describe('collectPackages', () => {
  it('walks transitive dependencies with node resolution and dedupes by name@version', () => {
    const nm = path.join(root, 'node_modules');
    writePkg(
      path.join(nm, 'a'),
      { name: 'a', version: '1.0.0', license: 'MIT', dependencies: { b: '^1', c: '^1' } },
      { LICENSE: 'MIT a' },
    );
    writePkg(path.join(nm, 'b'), {
      name: 'b',
      version: '1.0.0',
      license: 'ISC',
      dependencies: { c: '^1' },
    });
    writePkg(path.join(nm, 'c'), { name: 'c', version: '1.0.0', license: 'MIT' });
    // a nested copy of c with another version, only visible from inside b
    writePkg(path.join(nm, 'b', 'node_modules', 'c'), {
      name: 'c',
      version: '2.0.0',
      license: 'MIT',
    });

    const entries = collectPackages([{ fromDir: root, deps: ['a'] }]);
    expect(entries.map((e) => `${e.name}@${e.version}`)).toEqual([
      'a@1.0.0',
      'b@1.0.0',
      'c@1.0.0',
      'c@2.0.0',
    ]);
    expect(entries[0]).toMatchObject({ license: 'MIT', text: 'MIT a' });
  });

  it('includes optional dependencies that are installed and skips ones that are not', () => {
    const nm = path.join(root, 'node_modules');
    writePkg(path.join(nm, 'a'), {
      name: 'a',
      version: '1.0.0',
      license: 'MIT',
      optionalDependencies: { present: '1', missing: '1' },
    });
    writePkg(path.join(nm, 'present'), { name: 'present', version: '1.0.0', license: 'MIT' });
    const entries = collectPackages([{ fromDir: root, deps: ['a', 'not-installed'] }]);
    expect(entries.map((e) => e.name)).toEqual(['a', 'present']);
  });

  it('omits workspace packages but walks their dependencies', () => {
    const nm = path.join(root, 'node_modules');
    const ws = path.join(root, 'libs', 'own');
    writePkg(ws, { name: '@us/own', version: '0.1.0', license: 'MIT', dependencies: { dep: '1' } });
    fs.mkdirSync(path.join(nm, '@us'), { recursive: true });
    fs.symlinkSync(ws, path.join(nm, '@us', 'own'), 'dir');
    writePkg(path.join(nm, 'dep'), { name: 'dep', version: '1.0.0', license: 'MIT' });

    const entries = collectPackages([{ fromDir: root, deps: ['@us/own'] }]);
    expect(entries.map((e) => e.name)).toEqual(['dep']);
  });
});

describe('renderNotices', () => {
  it('produces stable JSON with packages sorted and binaries listed', () => {
    const json = renderNotices(
      [
        { name: 'z', version: '1.0.0', license: 'MIT' },
        { name: 'a', version: '1.0.0', license: 'MIT' },
      ],
      BUNDLED_BINARIES,
    );
    const parsed = JSON.parse(json);
    expect(parsed.packages.map((p: { name: string }) => p.name)).toEqual(['a', 'z']);
    expect(parsed.binaries.map((b: { name: string }) => b.name)).toEqual(
      BUNDLED_BINARIES.map((b) => b.name),
    );
    expect(renderNotices([...parsed.packages].reverse(), BUNDLED_BINARIES)).toBe(json);
  });

  it('lists each bundled binary with an SPDX license and a source URL', () => {
    for (const b of BUNDLED_BINARIES) {
      expect(b.license).toMatch(/^[A-Za-z0-9.\- ]+$/);
      expect(b.url).toMatch(/^https:\/\//);
    }
    expect(BUNDLED_BINARIES.find((b) => b.name === 'holochain')?.license).toBe('CAL-1.0');
  });
});

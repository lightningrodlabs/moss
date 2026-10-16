#!/usr/bin/env node
// Publish each given package directory whose version is not yet on npm, in an
// order where every package follows the sibling packages it depends on.
//
// Usage: node scripts/publish-npm.mjs [--dry-run] <package-dir>...
//
// Runs from .github/workflows/release-npm.yaml with npm trusted publishing
// (OIDC), so no npm token is involved.
//
// Dist-tag: DIST_TAG wins when it is set to anything but `auto`. Otherwise a
// prerelease goes to `next`, a version below the current `latest` goes to
// `release-<major>.<minor>` so a fix on an older line does not move `latest`,
// and anything else goes to `latest`.
//
// After each publish the script waits until the registry serves the new
// version, which can take several minutes while npm processes the package. Each package's prepublishOnly hook (scripts/publish-staleness.mjs)
// reads the registry to check the siblings it depends on, so the next package
// must not start before the previous one is visible.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(version);
  if (!match) throw new Error(`Not a semver version: ${version}`);
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  };
}

// Compares release versions only; prereleases never reach this comparison.
export function compareReleases(a, b) {
  const pa = parseVersion(a).core;
  const pb = parseVersion(b).core;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function distTagFor(version, currentLatest) {
  const parsed = parseVersion(version);
  if (parsed.prerelease) return 'next';
  if (currentLatest && !parseVersion(currentLatest).prerelease) {
    if (compareReleases(version, currentLatest) < 0) {
      return `release-${parsed.core[0]}.${parsed.core[1]}`;
    }
  }
  return 'latest';
}

export function resolveDistTag(override, version, currentLatest) {
  if (override && override !== 'auto') return override;
  return distTagFor(version, currentLatest);
}

/**
 * Order packages so each one comes after the packages in the set it depends
 * on. `deps` lists dependency names; names outside the set are ignored.
 */
export function publishOrder(packages) {
  const byName = new Map(packages.map((p) => [p.name, p]));
  const ordered = [];
  const state = new Map();
  const visit = (pkg) => {
    if (state.get(pkg.name) === 'done') return;
    if (state.get(pkg.name) === 'visiting') {
      throw new Error(`Dependency cycle through ${pkg.name}`);
    }
    state.set(pkg.name, 'visiting');
    for (const dep of pkg.deps) {
      const sibling = byName.get(dep);
      if (sibling) visit(sibling);
    }
    state.set(pkg.name, 'done');
    ordered.push(pkg);
  };
  for (const pkg of packages) visit(pkg);
  return ordered;
}

/**
 * Whether npm refused a publish because the version already exists. A version
 * that npm is still processing is invisible to `npm view` but blocks a second
 * publish, so a rerun sees this refusal and must treat it as done.
 */
export function isAlreadyPublished(stderr) {
  return /cannot publish over the previously published version/i.test(stderr);
}

function npmView(spec, field) {
  try {
    const out = execFileSync('npm', ['view', spec, field, '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return out ? JSON.parse(out) : null;
  } catch (e) {
    if (/E404|is not in this registry/.test(String(e.stderr))) return null;
    throw e;
  }
}

function waitUntilVisible(name, version) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (npmView(`${name}@${version}`, 'version')) return;
    execFileSync('sleep', ['10']);
  }
  throw new Error(`${name}@${version} did not appear on the registry within fifteen minutes`);
}

function publish(dir, args) {
  try {
    execFileSync('npm', args, { cwd: dir, stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8' });
    return 'published';
  } catch (e) {
    const stderr = String(e.stderr ?? '');
    process.stderr.write(stderr);
    if (isAlreadyPublished(stderr)) return 'already-published';
    throw e;
  }
}

function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const dirs = argv.filter((a) => a !== '--dry-run');
  if (dirs.length === 0) {
    throw new Error('Usage: publish-npm.mjs [--dry-run] <package-dir>...');
  }
  const override = process.env.DIST_TAG || '';

  const packages = publishOrder(
    dirs.map((dir) => {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies });
      return { dir, name: pkg.name, version: pkg.version, deps };
    }),
  );

  for (const { dir, name, version } of packages) {
    if (npmView(`${name}@${version}`, 'version')) {
      console.log(`skip ${name}@${version}: already published`);
      continue;
    }
    const tag = resolveDistTag(override, version, npmView(name, 'dist-tags.latest'));
    console.log(`publish ${name}@${version} --tag ${tag}`);
    const args = ['publish', '--access', 'public', '--tag', tag];
    if (dryRun) args.push('--dry-run');
    const outcome = publish(dir, args);
    if (outcome === 'already-published') {
      console.log(`${name}@${version}: npm already has this version, still processing`);
    }
    if (!dryRun) waitUntilVisible(name, version);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

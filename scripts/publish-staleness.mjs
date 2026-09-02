#!/usr/bin/env node
// Guards a publish against depending on a sibling @theweave/* package whose
// released tarball is older than that package's source.
//
// The monorepo hides this completely: yarn links every @theweave/* dependency
// to the workspace, so `import { thing } from '@theweave/utils'` resolves
// against source that may never have been released. The installed package
// resolves the same import against the registry instead, and dies at module
// load with "does not provide an export named …". A version number alone
// proves nothing — a package can sit at 0.7.0-dev.1 for a month while its
// source moves underneath it.
//
// Usage: node scripts/publish-staleness.mjs [package-dir]
//        PUBLISH_ALLOW_STALE_DEPS=1 node scripts/publish-staleness.mjs [dir]
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

import semver from 'semver';

/**
 * Decide which of `dependencies` an installer could not resolve to a release
 * that contains the current source.
 *
 * Kept free of git, network and filesystem access so the resolution rules can
 * be tested directly.
 *
 * @param {{
 *   dependencies: Record<string, string>,
 *   workspacePackages: Record<string, { lastSourceChange: string }>,
 *   registry: Record<string, { versions: Record<string, string> }>,
 * }} input
 * @returns {Array<{
 *   name: string, range: string, resolvedVersion: string | null,
 *   publishedAt: string | null, lastSourceChange: string,
 *   reason: 'stale' | 'unpublished',
 * }>}
 */
export function findStaleDependencies({ dependencies, workspacePackages, registry }) {
  const problems = [];
  for (const [name, range] of Object.entries(dependencies ?? {})) {
    const workspacePackage = workspacePackages[name];
    // A dependency with no workspace counterpart is a third-party package;
    // its releases are not ours to keep in step with our source.
    if (!workspacePackage) continue;

    const versions = registry[name]?.versions ?? {};
    const resolvedVersion = semver.maxSatisfying(Object.keys(versions), range);
    if (!resolvedVersion) {
      problems.push({
        name,
        range,
        resolvedVersion: null,
        publishedAt: null,
        lastSourceChange: workspacePackage.lastSourceChange,
        reason: 'unpublished',
      });
      continue;
    }

    const publishedAt = versions[resolvedVersion];
    if (Date.parse(publishedAt) < Date.parse(workspacePackage.lastSourceChange)) {
      problems.push({
        name,
        range,
        resolvedVersion,
        publishedAt,
        lastSourceChange: workspacePackage.lastSourceChange,
        reason: 'stale',
      });
    }
  }
  return problems;
}

const SCRIPT_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(SCRIPT_DIR, '..');

/**
 * Every workspace directory that publishes an @theweave/* package, keyed by
 * package name.
 */
function workspaceDirsByName() {
  const roots = ['libs', 'shared'];
  const dirs = ['wdocker', 'cli'];
  for (const root of roots) {
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, root), { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(path.join(root, entry.name));
    }
  }
  const byName = {};
  for (const dir of dirs) {
    const manifestPath = path.join(REPO_ROOT, dir, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (manifest.name?.startsWith('@theweave/')) byName[manifest.name] = dir;
  }
  return byName;
}

/**
 * When the package's shipped source last changed. Test files are excluded:
 * they never reach the tarball, so a test-only commit does not make a release
 * stale.
 */
function lastSourceChange(dir) {
  const iso = execFileSync(
    'git',
    [
      'log',
      '-1',
      '--format=%cI',
      '--',
      `${dir}/src`,
      `:(exclude)${dir}/src/**/*.test.ts`,
      `:(exclude)${dir}/src/**/*.test.tsx`,
    ],
    { cwd: REPO_ROOT, encoding: 'utf-8' },
  ).trim();
  return iso || null;
}

async function fetchRegistry(names) {
  const registry = {};
  for (const name of names) {
    const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`);
    if (!response.ok) {
      registry[name] = { versions: {} };
      continue;
    }
    const body = await response.json();
    const versions = {};
    for (const version of Object.keys(body.versions ?? {})) {
      if (body.time?.[version]) versions[version] = body.time[version];
    }
    registry[name] = { versions };
  }
  return registry;
}

function describe(problem) {
  if (problem.reason === 'unpublished') {
    return `${problem.name}@"${problem.range}" — no published version satisfies this range. Publish it before publishing this package.`;
  }
  return `${problem.name}@"${problem.range}" resolves to ${problem.resolvedVersion}, published ${problem.publishedAt}, but its source last changed ${problem.lastSourceChange}. Bump and publish ${problem.name} first, or an installed copy of this package resolves imports against a release that predates them.`;
}

async function main() {
  if (process.env.PUBLISH_ALLOW_STALE_DEPS) {
    console.log(
      'PUBLISH_ALLOW_STALE_DEPS is set — skipping the sibling dependency freshness check.',
    );
    return;
  }
  const dir = process.argv[2] ?? process.cwd();
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
  const dependencies = manifest.dependencies ?? {};

  const dirsByName = workspaceDirsByName();
  const workspacePackages = {};
  for (const name of Object.keys(dependencies)) {
    const workspaceDir = dirsByName[name];
    if (!workspaceDir) continue;
    const changed = lastSourceChange(workspaceDir);
    if (changed) workspacePackages[name] = { lastSourceChange: changed };
  }

  const names = Object.keys(workspacePackages);
  if (names.length === 0) {
    console.log(`${manifest.name}: no sibling @theweave/* dependencies to check.`);
    return;
  }

  let registry;
  try {
    registry = await fetchRegistry(names);
  } catch (e) {
    console.error(
      `Could not reach the npm registry to check ${manifest.name}'s dependencies: ${e.message}`,
    );
    console.error('Set PUBLISH_ALLOW_STALE_DEPS=1 to publish without this check.');
    process.exit(1);
  }
  const problems = findStaleDependencies({ dependencies, workspacePackages, registry });

  if (problems.length === 0) {
    console.log(
      `${manifest.name}: all ${names.length} sibling dependencies resolve to a release that contains their current source.`,
    );
    return;
  }

  console.error(`${manifest.name} depends on @theweave/* releases that are behind their source:`);
  for (const problem of problems) {
    console.error(`  ${describe(problem)}`);
  }
  console.error('Set PUBLISH_ALLOW_STALE_DEPS=1 to publish regardless.');
  process.exit(1);
}

// Only run the CLI when invoked directly, so importing the pure function in a
// test does not fire off network requests.
if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

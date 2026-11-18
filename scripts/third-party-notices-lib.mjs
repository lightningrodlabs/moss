// Collects the license notices of the third-party code Moss ships, for the
// About window. npm packages are found by walking the installed dependency
// tree from the workspaces that end up in the app; the native binaries Moss
// bundles are listed by hand because they do not come from npm.

import fs from 'node:fs';
import path from 'node:path';

/**
 * Binaries shipped under resources/bins (fetched or built by scripts/fetch-binaries.mjs
 * and scripts/build-whisper-server.mjs).
 */
export const BUNDLED_BINARIES = [
  {
    name: 'holochain',
    license: 'CAL-1.0',
    copyright: 'Copyright (c) Holochain Foundation',
    url: 'https://github.com/holochain/holochain',
  },
  {
    name: 'lair-keystore',
    license: 'MIT OR Apache-2.0',
    copyright: 'Copyright (c) Holochain Foundation',
    url: 'https://github.com/holochain/lair',
  },
  {
    name: 'kitsune2-bootstrap-srv',
    license: 'Apache-2.0',
    copyright: 'Copyright (c) Holochain Foundation',
    url: 'https://github.com/holochain/kitsune2',
  },
  {
    name: 'whisper.cpp (whisper-server)',
    license: 'MIT',
    copyright: 'Copyright (c) 2023-2024 The ggml authors',
    url: 'https://github.com/ggml-org/whisper.cpp',
  },
];

/** SPDX expression for a package.json, accepting the legacy object/array forms. */
export function licenseOf(pkg) {
  const asString = (l) =>
    typeof l === 'string' ? l : l && typeof l.type === 'string' ? l.type : undefined;
  const single = asString(pkg.license);
  if (single) return single;
  if (Array.isArray(pkg.licenses)) {
    const all = pkg.licenses.map(asString).filter(Boolean);
    if (all.length) return all.join(' OR ');
  }
  return 'UNKNOWN';
}

/** Browsable https URL for the package source, from `repository` or `homepage`. */
export function repositoryUrl(pkg) {
  const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (typeof raw === 'string') {
    let url = raw.trim();
    const shorthand = url.match(/^(?:github:)?([\w.-]+\/[\w.-]+)$/);
    if (shorthand) url = `https://github.com/${shorthand[1]}`;
    url = url
      .replace(/^git\+/, '')
      .replace(/^git:\/\//, 'https://')
      .replace(/^git@([^:]+):/, 'https://$1/')
      .replace(/\.git$/, '');
    if (/^https?:\/\//.test(url)) return url;
  }
  if (typeof pkg.homepage === 'string' && /^https?:\/\//.test(pkg.homepage)) return pkg.homepage;
  return undefined;
}

const LICENSE_FILE = /^(licen[cs]e|copying)([.-].*)?$/i;

/** Text of the package's license file, if it ships one. */
export function findLicenseText(pkgDir) {
  let names;
  try {
    names = fs.readdirSync(pkgDir);
  } catch {
    return undefined;
  }
  const file = names.filter((n) => LICENSE_FILE.test(n)).sort()[0];
  if (!file) return undefined;
  const full = path.join(pkgDir, file);
  if (!fs.statSync(full).isFile()) return undefined;
  return fs.readFileSync(full, 'utf8').trim();
}

/** Node module resolution: the nearest node_modules/<name> above fromDir. */
function resolvePackageDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Walks the dependency tree from each seed and returns one entry per distinct
 * name@version, sorted. Workspace packages (whose real path is not inside a
 * node_modules directory) are our own code: they are not listed, but their
 * dependencies are.
 *
 * @param {{ fromDir: string, deps: string[] }[]} seeds
 */
export function collectPackages(seeds) {
  const visitedDirs = new Set();
  const entries = new Map();
  const queue = seeds.flatMap((s) => s.deps.map((name) => ({ name, fromDir: s.fromDir })));

  while (queue.length) {
    const { name, fromDir } = queue.shift();
    const found = resolvePackageDir(name, fromDir);
    if (!found) continue;
    const dir = fs.realpathSync(found);
    if (visitedDirs.has(dir)) continue;
    visitedDirs.add(dir);

    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const isWorkspace = !dir.split(path.sep).includes('node_modules');
    if (!isWorkspace) {
      const key = `${pkg.name}@${pkg.version}`;
      if (!entries.has(key)) {
        const text = findLicenseText(dir);
        const url = repositoryUrl(pkg);
        entries.set(key, {
          name: pkg.name,
          version: pkg.version,
          license: licenseOf(pkg),
          ...(url ? { url } : {}),
          ...(text ? { text } : {}),
        });
      }
    }
    const next = { ...(pkg.optionalDependencies ?? {}), ...(pkg.dependencies ?? {}) };
    for (const dep of Object.keys(next)) queue.push({ name: dep, fromDir: dir });
  }

  return sortEntries([...entries.values()]);
}

function sortEntries(entries) {
  return [...entries].sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
  );
}

/** Serialized notices file read by the About window. */
export function renderNotices(packages, binaries) {
  return JSON.stringify({ binaries, packages: sortEntries(packages) }, null, 1) + '\n';
}

#!/usr/bin/env node
// Writes src/renderer/public/third-party-notices.json, the list of third-party
// licenses shown in the About window. Runs as part of `yarn build`, so the list
// always matches the installed dependency tree; the output is not committed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUNDLED_BINARIES, collectPackages, renderNotices } from './third-party-notices-lib.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(REPO_ROOT, 'src', 'renderer', 'public', 'third-party-notices.json');

const depsOf = (rel) =>
  Object.keys(
    JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel, 'package.json'), 'utf8')).dependencies ??
      {},
  );

// The workspaces whose code ends up in the packaged app: main/preload (root),
// the renderer, and the applet iframe. Electron is a root devDependency but its
// runtime ships with the app.
const seeds = [
  { fromDir: REPO_ROOT, deps: [...depsOf('.'), 'electron'] },
  { fromDir: path.join(REPO_ROOT, 'src', 'renderer'), deps: depsOf('src/renderer') },
  {
    fromDir: path.join(REPO_ROOT, 'iframes', 'applet-iframe'),
    deps: depsOf('iframes/applet-iframe'),
  },
];

const packages = collectPackages(seeds);
fs.writeFileSync(OUT_FILE, renderNotices(packages, BUNDLED_BINARIES));
const unknown = packages.filter((p) => p.license === 'UNKNOWN').map((p) => p.name);
console.log(
  `Wrote ${packages.length} package notices to ${path.relative(REPO_ROOT, OUT_FILE)}` +
    (unknown.length ? ` (no declared license: ${unknown.join(', ')})` : ''),
);

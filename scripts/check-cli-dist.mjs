#!/usr/bin/env node
// Guards @theweave/cli publishes against shipping an incomplete package.
// `yarn build:cli` assembles cli/dist from build outputs scattered across the
// repo (out/, resources/, moss.config.json, ...), so a missing build step
// produces a tarball that installs fine but crashes at runtime. This check
// runs as the cli package's prepublishOnly hook and fails the publish if any
// runtime-required file is absent.
//
// Usage: node scripts/check-cli-dist.mjs [cli-package-dir]
//        node scripts/check-cli-dist.mjs --print-required
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

// Paths relative to the cli package root. Every entry is read by the CLI at
// startup or required for `weave` to launch at all.
const REQUIRED_FILES = [
  'cli.js',
  'defineConfig.js',
  'defineConfig.d.ts',
  'fetch-binaries.mjs',
  'dist/main/index.js',
  'dist/main/moss.config.json',
  'dist/main/holochain-checksums.json',
  // Read via top-level fs.readFileSync in src/main/customSchemes.ts — if
  // either is missing the main process dies on launch.
  'dist/applet-iframe/index.mjs',
  'dist/happ-iframe/index.mjs',
  'dist/main/resources/conductor-config.yaml',
  'dist/main/resources/default-apps/group.happ',
  'dist/preload/admin.js',
  'dist/preload/splashscreen.js',
  'dist/preload/selectmediasource.js',
  'dist/preload/walwindow.js',
  'dist/renderer/index.html',
  'dist/renderer/splashscreen.html',
  'dist/renderer/selectmediasource.html',
  'dist/renderer/walwindow.html',
];

function main() {
  const arg = process.argv[2];
  if (arg === '--print-required') {
    console.log(REQUIRED_FILES.join('\n'));
    return;
  }
  const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
  const root = arg ?? path.join(scriptDir, '..', 'cli');
  const missing = REQUIRED_FILES.filter((file) => !fs.existsSync(path.join(root, file)));
  if (missing.length > 0) {
    console.error(`cli package at ${root} is missing required files:`);
    for (const file of missing) {
      console.error(`  ${file}`);
    }
    console.error('Run `yarn build` from the repo root to produce a complete cli/dist.');
    process.exit(1);
  }
  console.log(`cli package at ${root}: all ${REQUIRED_FILES.length} required files present.`);
}

main();

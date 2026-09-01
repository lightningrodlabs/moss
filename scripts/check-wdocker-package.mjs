#!/usr/bin/env node
// Guards @theweave/wdocker publishes. Two failure modes have shipped to npm
// before and both are invisible until a user runs the CLI:
//   - `file:../…` dependency specs, which npm publishes literally: the install
//     succeeds, leaves dangling symlinks, and every command dies at module load
//     with ERR_MODULE_NOT_FOUND.
//   - a dist/ assembled by an earlier `yarn build`, carrying a moss.config.json
//     from a previous Holochain line, so the CLI downloads the wrong conductor.
// This runs as the wdocker package's prepublishOnly hook.
//
// Usage: node scripts/check-wdocker-package.mjs [package-dir] [reference-moss-config]
//        node scripts/check-wdocker-package.mjs --print-required
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

// Paths relative to the wdocker package root, all read at runtime: cli.js and
// daemon.js are the two bin entry points, and src/const.ts reads the other
// three with a top-level readFileSync.
const REQUIRED_FILES = [
  'dist/cli.js',
  'dist/daemon/daemon.js',
  'dist/moss.config.json',
  'dist/holochain-checksums.json',
  'dist/conductor-config.yaml',
];

// Imported from wdocker/src and therefore required at runtime by the installed
// package. Kept explicit so adding an import without declaring the dependency
// fails the publish rather than the user's first run.
const REQUIRED_THEWEAVE_DEPS = [
  '@theweave/api',
  '@theweave/group-client',
  '@theweave/moss-types',
  '@theweave/utils',
];

function main() {
  const arg = process.argv[2];
  if (arg === '--print-required') {
    console.log(REQUIRED_FILES.join('\n'));
    return;
  }
  const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
  const root = arg ?? path.join(scriptDir, '..', 'wdocker');
  const referenceConfigPath = process.argv[3] ?? path.join(scriptDir, '..', 'moss.config.json');
  const problems = [];

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
  const deps = pkg.dependencies ?? {};

  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec === 'string' && (spec.startsWith('file:') || spec.startsWith('link:'))) {
      problems.push(
        `dependency ${name} is declared as "${spec}" — npm publishes that spec literally and the installed package cannot resolve it. Use the published version instead.`,
      );
    }
  }

  for (const name of REQUIRED_THEWEAVE_DEPS) {
    if (!deps[name]) {
      problems.push(`dependency ${name} is imported by wdocker/src but not declared.`);
    }
  }

  for (const file of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(root, file))) {
      problems.push(`missing required file ${file} — run \`yarn workspace @theweave/wdocker build\`.`);
    }
  }

  const distConfigPath = path.join(root, 'dist/moss.config.json');
  if (fs.existsSync(distConfigPath) && fs.existsSync(referenceConfigPath)) {
    const distConfig = JSON.parse(fs.readFileSync(distConfigPath, 'utf-8'));
    const reference = JSON.parse(fs.readFileSync(referenceConfigPath, 'utf-8'));
    if (distConfig.holochain !== reference.holochain) {
      problems.push(
        `dist/moss.config.json pins Holochain ${distConfig.holochain} but the repo is on ${reference.holochain} — dist/ is stale, rebuild it.`,
      );
    }
  }

  if (problems.length > 0) {
    console.error(`wdocker package at ${root} is not publishable:`);
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    process.exit(1);
  }
  console.log(`wdocker package at ${root}: dependencies and dist contents OK.`);
}

main();

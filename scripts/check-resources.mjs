/**
 * Asserts that every artifact electron-builder packs out of ./resources is actually
 * present before packaging, and that each one has the expected sha256.
 *
 * Motivation: `resources/` is gitignored in its entirety (bar a few tracked files),
 * and it is populated by several *separate* fetch steps. A fresh clone or git
 * worktree that runs only some of them still builds and packages successfully --
 * the missing file is only discovered at runtime, by a user. That is exactly how a
 * field-test build shipped without resources/default-apps/group.happ and failed on
 * group creation with:
 *
 *   FfsIoError NotFound: .../app.asar.unpacked/resources/default-apps/group.happ
 *
 * check-binaries.mjs only covered two of the binaries, so it did not catch it.
 * This script covers the whole inventory. It is intentionally exhaustive rather
 * than clever: every packaged path is listed explicitly.
 */

import fs from 'fs';
import path from 'path';
import { sha256OfFile } from './fetch-fns.mjs';

const mossConfig = JSON.parse(fs.readFileSync('moss.config.json', 'utf-8'));
const checksums = JSON.parse(fs.readFileSync('holochain-checksums.json', 'utf-8'));

const exe = process.platform === 'win32' ? '.exe' : '';
const holochainVersion = mossConfig.holochain;
const bootstrapSrvVersion = mossConfig.kitsune2BootstrapSrv ?? checksums.version;

let targetEnding;
switch (`${process.platform}-${process.arch}`) {
  case 'linux-x64':
    targetEnding = 'x86_64-unknown-linux-gnu';
    break;
  case 'linux-arm64':
    targetEnding = 'aarch64-unknown-linux-gnu';
    break;
  case 'darwin-x64':
    targetEnding = 'x86_64-apple-darwin';
    break;
  case 'darwin-arm64':
    targetEnding = 'aarch64-apple-darwin';
    break;
  case 'win32-x64':
    // NB: the checksum keys carry a `.exe` suffix for this target.
    targetEnding = 'x86_64-pc-windows-msvc.exe';
    break;
  default:
    targetEnding = null;
}

/**
 * Each entry: the path that must exist, and optionally the sha256 it must have.
 * A null sha means "presence only" (tracked-in-git files, whose content is the
 * repo's business rather than a fetch step's).
 */
const REQUIRED = [
  // --- binaries, from `yarn fetch:binaries` / `yarn fetch:hc` /
  //     `yarn install:local-binaries` (field-test branch only) ---
  {
    file: path.join('resources', 'bins', `holochain-v${holochainVersion}${exe}`),
    sha256: targetEnding ? checksums.holochain?.[targetEnding] : null,
    source: 'yarn install:local-binaries (patched) / yarn fetch:binaries',
  },
  {
    file: path.join('resources', 'bins', `lair-keystore-v${holochainVersion}${exe}`),
    sha256: targetEnding ? checksums['lair-keystore']?.[targetEnding] : null,
    source: 'yarn fetch:binaries',
  },
  {
    file: path.join('resources', 'bins', `kitsune2-bootstrap-srv-v${bootstrapSrvVersion}${exe}`),
    sha256: targetEnding ? checksums['kitsune2-bootstrap-srv']?.[targetEnding] : null,
    source: 'yarn fetch:binaries',
  },
  {
    file: path.join('resources', 'bins', `hc-v${holochainVersion}${exe}`),
    sha256: targetEnding ? checksums.hc?.[targetEnding] : null,
    source: 'yarn install:local-binaries (patched) / yarn fetch:binaries',
  },
  {
    file: path.join('resources', 'bins', `hc${exe}`),
    sha256: targetEnding ? checksums.hc?.[targetEnding] : null,
    source: 'yarn install:local-binaries (patched) / yarn fetch:hc',
  },

  // --- default apps, from `yarn fetch:group-happ` ---
  // Read by src/main/index.ts on group creation via DEFAULT_APPS_DIRECTORY.
  // Missing this one packages cleanly and only fails when a user makes a group.
  {
    file: path.join('resources', 'default-apps', 'group.happ'),
    sha256: mossConfig.groupHapp?.sha256 ?? null,
    source: 'yarn fetch:group-happ',
  },

  // --- tracked in git, but packaged, so assert them anyway ---
  { file: path.join('resources', 'conductor-config.yaml'), sha256: null, source: 'git' },
  { file: path.join('resources', 'icon.png'), sha256: null, source: 'git' },
  { file: path.join('resources', 'icons', '128x128.png'), sha256: null, source: 'git' },
  { file: path.join('resources', 'icons', '128x128@2x.png'), sha256: null, source: 'git' },
  { file: path.join('resources', 'icons', '32x32@2x.png'), sha256: null, source: 'git' },
  {
    file: path.join('resources', 'icons', 'icon_priority_high_32x32@2x.png'),
    sha256: null,
    source: 'git',
  },
  {
    file: path.join('resources', 'icons', 'icon_priority_medium_32x32@2x.png'),
    sha256: null,
    source: 'git',
  },
  {
    file: path.join('resources', 'icons', 'icon_systray_32x32@2x.png'),
    sha256: null,
    source: 'git',
  },
  {
    file: path.join('resources', 'icons', 'transparent32x32@2x.png'),
    sha256: null,
    source: 'git',
  },
];

const missing = [];
const mismatched = [];
const unverified = [];

for (const { file, sha256, source } of REQUIRED) {
  if (!fs.existsSync(file)) {
    missing.push({ file, source });
    continue;
  }
  if (!sha256) {
    if (source !== 'git') unverified.push(file);
    continue;
  }
  const actual = sha256OfFile(file);
  if (actual !== sha256) mismatched.push({ file, actual, expected: sha256, source });
}

for (const file of unverified) {
  console.warn(`WARNING: no expected sha256 available for ${file}; presence checked only.`);
}

if (missing.length > 0 || mismatched.length > 0) {
  let msg = '\nResource check FAILED.\n';
  if (missing.length > 0) {
    msg += '\nMissing files:\n';
    for (const { file, source } of missing) msg += `  - ${file}\n      populate with: ${source}\n`;
  }
  if (mismatched.length > 0) {
    msg += '\nFiles present but with an unexpected sha256:\n';
    for (const { file, actual, expected, source } of mismatched) {
      msg += `  - ${file}\n      got:      ${actual}\n      expected: ${expected}\n      re-run:   ${source}\n`;
    }
  }
  msg += '\nSee RUNBOOK-fieldtest.md "Populating a fresh worktree" for the full sequence.\n';
  throw new Error(msg);
}

console.log(`Resource check passed: ${REQUIRED.length} packaged files present and verified.`);

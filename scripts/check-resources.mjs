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
import { ASSET_TARGET, assertSha256, sha256OfFile } from './fetch-fns.mjs';
import { holochainBinaryName, versionedBinaryName } from './binary-names.mjs';

const mossConfig = JSON.parse(fs.readFileSync('moss.config.json', 'utf-8'));
const checksums = JSON.parse(fs.readFileSync('holochain-checksums.json', 'utf-8'));

const exe = process.platform === 'win32' ? '.exe' : '';
const bootstrapSrvVersion = mossConfig.kitsune2BootstrapSrv ?? checksums.version;

// Binary filenames come from the shared derivation so this check looks for the
// same file the app will look for at runtime, fork tag included.
const bin = (name) => path.join('resources', 'bins', holochainBinaryName(name, mossConfig));

// ASSET_TARGET is the single host->checksum-key mapping, shared with
// fetch-fns.mjs so this check and the fetch can never disagree about which key
// applies (they used to, on Windows).

/**
 * Each entry: the path that must exist, and the sha256 it must have.
 * `presenceOnly: true` means the file is tracked in git, so its content is the
 * repo's business rather than a fetch step's and only its presence is asserted.
 * Every other entry MUST resolve to a real sha256: an absent or placeholder
 * checksum fails the check rather than downgrading it to a presence check.
 */
const REQUIRED = [
  // --- binaries, from `yarn fetch:binaries` / `yarn fetch:hc` /
  //     `yarn install:local-binaries` (field-test branch only) ---
  {
    file: bin('holochain'),
    sha256: checksums.holochain?.[ASSET_TARGET],
    source: 'yarn install:local-binaries (patched) / yarn fetch:binaries',
  },
  {
    file: bin('lair-keystore'),
    sha256: checksums['lair-keystore']?.[ASSET_TARGET],
    source: 'yarn fetch:binaries',
  },
  {
    file: path.join(
      'resources',
      'bins',
      versionedBinaryName('kitsune2-bootstrap-srv', bootstrapSrvVersion),
    ),
    sha256: checksums['kitsune2-bootstrap-srv']?.[ASSET_TARGET],
    source: 'yarn fetch:binaries',
  },
  {
    file: bin('hc'),
    sha256: checksums.hc?.[ASSET_TARGET],
    source: 'yarn install:local-binaries (patched) / yarn fetch:binaries',
  },
  {
    file: path.join('resources', 'bins', `hc${exe}`),
    sha256: checksums.hc?.[ASSET_TARGET],
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
  { file: path.join('resources', 'conductor-config.yaml'), presenceOnly: true, source: 'git' },
  { file: path.join('resources', 'icon.png'), presenceOnly: true, source: 'git' },
  { file: path.join('resources', 'icons', '128x128.png'), presenceOnly: true, source: 'git' },
  { file: path.join('resources', 'icons', '128x128@2x.png'), presenceOnly: true, source: 'git' },
  { file: path.join('resources', 'icons', '32x32@2x.png'), presenceOnly: true, source: 'git' },
  {
    file: path.join('resources', 'icons', 'icon_priority_high_32x32@2x.png'),
    presenceOnly: true,
    source: 'git',
  },
  {
    file: path.join('resources', 'icons', 'icon_priority_medium_32x32@2x.png'),
    presenceOnly: true,
    source: 'git',
  },
  {
    file: path.join('resources', 'icons', 'icon_systray_32x32@2x.png'),
    presenceOnly: true,
    source: 'git',
  },
  {
    file: path.join('resources', 'icons', 'transparent32x32@2x.png'),
    presenceOnly: true,
    source: 'git',
  },
];

const missing = [];
const mismatched = [];
const unpinned = [];

for (const { file, sha256, source, presenceOnly } of REQUIRED) {
  if (!fs.existsSync(file)) {
    missing.push({ file, source });
    continue;
  }
  if (presenceOnly) continue;
  // Previously an absent checksum silently downgraded this to a presence check
  // and merely warned. It is now a failure: an unpinned artifact is exactly the
  // thing this check exists to keep out of a build.
  try {
    assertSha256(sha256, file);
  } catch (error) {
    unpinned.push({ file, source, reason: error.message });
    continue;
  }
  const actual = sha256OfFile(file);
  if (actual !== sha256) mismatched.push({ file, actual, expected: sha256, source });
}

if (missing.length > 0 || mismatched.length > 0 || unpinned.length > 0) {
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
  if (unpinned.length > 0) {
    msg += '\nFiles with no usable pinned sha256 (checksum missing or still a placeholder):\n';
    for (const { file, reason } of unpinned) {
      msg += `  - ${file}\n      ${reason.split('\n').join('\n      ')}\n`;
    }
  }
  msg += '\nSee RUNBOOK-fieldtest.md "Populating a fresh worktree" for the full sequence.\n';
  throw new Error(msg);
}

console.log(`Resource check passed: ${REQUIRED.length} packaged files present and verified.`);

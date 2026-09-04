/**
 * FIELD-TEST-ONLY -- branch feat/mdns-dev-build-0.7. DO NOT MERGE TO main-0.7.
 *
 * The field test runs a locally built, PATCHED holochain 0.7.0 from the
 * holochain-lrl checkout, branch feat/mdns-bootstrap-0.7.0-hello (mDNS LAN
 * discovery on top of the hello/PoK access module). Use this when those binaries
 * are not published as GitHub release assets yet, so `yarn fetch:binaries` has
 * nothing to download them from.
 *
 * This script copies the locally built binaries into ./resources/bins under the
 * exact filenames the rest of the toolchain expects, and verifies each one against
 * holochain-checksums.json. Because scripts/fetch-fns.mjs skips downloading any
 * file that is already present with the expected sha256, running this before
 * `yarn fetch:binaries` makes the fetch a no-op for the patched binaries while
 * still downloading the unpatched ones (lair-keystore, kitsune2-bootstrap-srv).
 *
 * Usage:
 *   yarn install:local-binaries
 *   MOSS_PATCHED_BIN_DIR=/path/to/holochain/target/release yarn install:local-binaries
 *
 * See RUNBOOK-fieldtest.md for how to reproduce the binaries.
 */

import fs from 'fs';
import path from 'path';
import { resolvedBinaryName, sha256OfFile } from './fetch-fns.mjs';

// The mDNS build is made in the holochain-lrl checkout next to this repo, with
// CARGO_TARGET_DIR=target-local so it does not collide with that checkout's own
// builds. Set MOSS_PATCHED_BIN_DIR if yours lives elsewhere.
//
// Whatever the source, a binary is installed only if it hashes to the pinned
// checksum. A build against a different glibc baseline than the pinned artifact
// -- the reason the release binaries are cargo-zigbuild'd, so they start on
// older distros -- has different bytes and is refused here rather than shipped.
// See RUNBOOK-fieldtest.md section 3.
const DEFAULT_PATCHED_BIN_DIR = '../holochain-lrl/target-local/release';

const sourceDir = process.env.MOSS_PATCHED_BIN_DIR ?? DEFAULT_PATCHED_BIN_DIR;

const checksums = JSON.parse(fs.readFileSync('holochain-checksums.json', 'utf-8'));

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error(
    `The hello/PoK field test binaries are only built for linux x64. Got ${process.platform}/${process.arch}. See RUNBOOK-fieldtest.md.`,
  );
}
const targetEnding = 'x86_64-unknown-linux-gnu';

// sourceName -> list of destination filenames in resources/bins.
// `hc` is placed both with and without the version suffix because
// fetch-binaries.mjs produces `hc-v<version>` and fetch-hc.mjs produces `hc`.
const BINARIES = {
  holochain: [resolvedBinaryName('holochain')],
  hc: [resolvedBinaryName('hc'), 'hc'],
};

const binariesDir = path.join('resources', 'bins');
fs.mkdirSync(binariesDir, { recursive: true });

if (!fs.existsSync(sourceDir)) {
  throw new Error(
    `Patched binary directory not found: ${sourceDir}\nSet MOSS_PATCHED_BIN_DIR to your holochain target/release directory. See RUNBOOK-fieldtest.md.`,
  );
}

for (const [sourceName, destNames] of Object.entries(BINARIES)) {
  const sourcePath = path.join(sourceDir, sourceName);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(
      `Patched binary not found: ${sourcePath}\nBuild it first, see RUNBOOK-fieldtest.md.`,
    );
  }

  const expected = checksums[sourceName][targetEnding];
  const actual = sha256OfFile(sourcePath);
  if (actual !== expected) {
    throw new Error(
      `sha256 mismatch for ${sourcePath}.\n  got:      ${actual}\n  expected: ${expected}\nThis binary is not the one holochain-checksums.json was pinned to. Either you built a different revision, or you are looking at a stock binary.`,
    );
  }

  for (const destName of destNames) {
    const destPath = path.join(binariesDir, destName);
    fs.copyFileSync(sourcePath, destPath);
    fs.chmodSync(destPath, 511);
    console.log(`Installed patched ${sourceName} -> ${destPath} (sha256 ${actual})`);
  }
}

console.log('\nPatched binaries installed. Run `yarn fetch:binaries` next; it will skip these.');

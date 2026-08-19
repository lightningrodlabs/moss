/**
 * FIELD-TEST-ONLY -- branch feat/hello-pok-fieldtest. DO NOT MERGE TO main-0.7.
 *
 * The hello/PoK field test runs a locally built, PATCHED holochain 0.7.0 from
 * lightningrodlabs/holochain branch feat/hello-pok-access-0.7. Those binaries are
 * not published as GitHub release assets, so `yarn fetch:binaries` has nothing to
 * download them from.
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
import { sha256OfFile } from './fetch-fns.mjs';

// NOTE: this is the cargo-zigbuild output dir (glibc 2.34 baseline), NOT
// target/release. A plain `cargo build --release` inherits the build machine's
// glibc and produces binaries that fail to start on older distros. Never point
// this at target/release. See RUNBOOK-fieldtest.md section 3.
const DEFAULT_PATCHED_BIN_DIR =
  '/home/eric/code/metacurrency/holochain/holochain-hello-07/target/x86_64-unknown-linux-gnu/release';

const sourceDir = process.env.MOSS_PATCHED_BIN_DIR ?? DEFAULT_PATCHED_BIN_DIR;

const checksums = JSON.parse(fs.readFileSync('holochain-checksums.json', 'utf-8'));
const version = checksums.version;

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
  holochain: [`holochain-v${version}`],
  hc: [`hc-v${version}`, 'hc'],
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

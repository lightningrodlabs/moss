/**
 * Asserts that the holochain toolchain binaries in ./resources/bins are present
 * AND are the exact artifacts holochain-checksums.json pins.
 *
 * Presence alone is not enough. `resources/bins` is gitignored and survives
 * branch switches, so a binary left behind by a previous branch -- a stock
 * holochain where a fork build is wanted, or an older fork build -- satisfies an
 * existence check and is then packaged or run as if it were the pinned one.
 * Hashing each file is what makes that impossible.
 */

import fs from 'fs';
import path from 'path';
import { expectedSha256For, sha256OfFile } from './fetch-fns.mjs';
import { holochainBinaryName } from './binary-names.mjs';

const mossConfig = JSON.parse(fs.readFileSync('moss.config.json', 'utf-8'));

const binariesDirectory = path.join('resources', 'bins');

// `hc` is included because a fork build ships a patched `hc` too, and a stale one
// silently produces happs against the wrong toolchain.
const BINARIES = ['holochain', 'hc', 'lair-keystore'];

const problems = [];

for (const binaryName of BINARIES) {
  const filename = holochainBinaryName(binaryName, mossConfig);
  const filePath = path.join(binariesDirectory, filename);

  if (!fs.existsSync(filePath)) {
    const foundBinaries = fs.existsSync(binariesDirectory) ? fs.readdirSync(binariesDirectory) : [];
    problems.push(
      `${filePath} is missing.\n` +
        `    available in ./resources/bins: [${foundBinaries.join(', ')}]\n` +
        `    populate with: yarn fetch:binaries`,
    );
    continue;
  }

  // expectedSha256For throws if the checksum is absent or a placeholder -- an
  // unpinned binary is a failure, not a skipped check.
  let expected;
  try {
    expected = expectedSha256For(binaryName);
  } catch (error) {
    problems.push(`${filePath}:\n    ${error.message.split('\n').join('\n    ')}`);
    continue;
  }

  const actual = sha256OfFile(filePath);
  if (actual !== expected) {
    problems.push(
      `${filePath} is not the pinned binary.\n` +
        `    expected sha256: ${expected}\n` +
        `    actual sha256:   ${actual}\n` +
        `    re-fetch it: rm ${filePath} && yarn fetch:binaries`,
    );
  }
}

if (problems.length > 0) {
  throw new Error(
    `\nBinary check FAILED.\n\n${problems.map((p) => `  - ${p}`).join('\n\n')}\n\n` +
      `See RUNBOOK-fieldtest.md "Populating a fresh worktree" for the full sequence.\n`,
  );
}

console.log(`Binary check passed: ${BINARIES.length} binaries present and verified by sha256.`);

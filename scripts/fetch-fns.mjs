import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import crypto from 'crypto';

const configJSON = fs.readFileSync('holochain-checksums.json');
const HOLOCHAIN_CHECKSUMS = JSON.parse(configJSON);

/**
 * Where holochain release assets come from unless a binary overrides it.
 */
const DEFAULT_BINARIES_REPO = 'holochain/holochain';

const binariesDir = path.join('resources', 'bins');
fs.mkdirSync(binariesDir, { recursive: true });

let hostTriple;
switch (process.platform) {
  case 'linux':
    switch (process.arch) {
      case 'arm64':
        hostTriple = 'aarch64-unknown-linux-gnu';
        break;
      case 'x64':
        hostTriple = 'x86_64-unknown-linux-gnu';
        break;
      default:
        throw new Error(`Got unexpected Linux architecture: ${process.arch}`);
    }
    break;
  case 'win32':
    hostTriple = 'x86_64-pc-windows-msvc';
    break;
  case 'darwin':
    switch (process.arch) {
      case 'arm64':
        hostTriple = 'aarch64-apple-darwin';
        break;
      case 'x64':
        hostTriple = 'x86_64-apple-darwin';
        break;
      default:
        throw new Error(`Got unexpected macOS architecture: ${process.arch}`);
    }
    break;
  default:
    throw new Error(`Got unexpected OS platform: ${process.platform}`);
}

const EXE_SUFFIX = process.platform === 'win32' ? '.exe' : '';

/**
 * The release-asset target suffix for this host -- e.g.
 * `x86_64-unknown-linux-gnu`, or `x86_64-pc-windows-msvc.exe` on Windows.
 *
 * This is deliberately ONE value used for two purposes: it is both the tail of
 * the release asset filename (`holochain-x86_64-pc-windows-msvc.exe`) and the
 * key under which that asset's sha256 is stored in holochain-checksums.json.
 * They must be identical, and previously were not: the checksum lookup used the
 * bare triple on Windows while the keys carry a `.exe` suffix, so the lookup
 * silently returned `undefined` and -- because verification was guarded by
 * `if (expectedSha256Hex && ...)` -- Windows downloads were never verified at
 * all. Deriving both from a single constant makes that class of drift
 * impossible.
 */
export const ASSET_TARGET = `${hostTriple}${EXE_SUFFIX}`;

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * sha256 (hex) of a file on disk, or null if the file does not exist.
 */
export function sha256OfFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const hasher = crypto.createHash('sha256');
  hasher.update(fs.readFileSync(filePath));
  return hasher.digest('hex');
}

/**
 * Checksum pinning is ENFORCED, not advisory: a download with no usable expected
 * sha256 is a hard failure rather than a silent skip. An absent or placeholder
 * entry means the pinning that makes this whole scheme safe does not apply to
 * that artifact, which is strictly worse than not building at all.
 *
 * Throws unless `value` is a lowercase 64-char hex digest.
 */
export function assertSha256(value, what) {
  if (!value) {
    throw new Error(
      `No expected sha256 available for ${what}.\n` +
        `Downloads are only permitted against a pinned checksum. Add the entry to ` +
        `holochain-checksums.json (see RUNBOOK-fieldtest.md) and try again.`,
    );
  }
  if (!SHA256_HEX.test(value)) {
    throw new Error(
      `The expected sha256 for ${what} is not a sha256: "${value}".\n` +
        `This is a placeholder, not a checksum -- the artifact it stands for has not ` +
        `been pinned yet. Fill it in from the release it is supposed to come from ` +
        `(see RUNBOOK-fieldtest.md) before building.`,
    );
  }
  return value;
}

/**
 * The pinned sha256 for `binaryName` on this host, as a hard requirement.
 */
export function expectedSha256For(binaryName) {
  const value = HOLOCHAIN_CHECKSUMS[binaryName]?.[ASSET_TARGET];
  return assertSha256(value, `${binaryName} (${ASSET_TARGET})`);
}

/**
 * Which GitHub release a given binary's assets are pulled from.
 *
 * Defaults to the stock holochain releases: repo `holochain/holochain`, tag
 * `holochain-<version>`. `holochain-checksums.json` may override this per
 * binary through a `binarySources` block:
 *
 *   "binarySources": {
 *     "holochain": {
 *       "binariesRepo": "lightningrodlabs/holochain",
 *       "binariesTag": "holochain-0.7.0-hello.0"
 *     }
 *   }
 *
 * The override is deliberately per-binary and not global. The hello/PoK field
 * test repoints only `holochain` and `hc` at a fork release; `lair-keystore` and
 * `kitsune2-bootstrap-srv` are unpatched and must keep coming from the stock
 * release, which they do simply by having no entry here.
 */
export function binarySourceFor(binaryName, version) {
  const override = HOLOCHAIN_CHECKSUMS.binarySources?.[binaryName] ?? {};
  return {
    repo: override.binariesRepo ?? DEFAULT_BINARIES_REPO,
    tag: override.binariesTag ?? `holochain-${version}`,
  };
}

export function downloadFile(url, targetPath, expectedSha256Hex, chmod = false) {
  // A missing or placeholder checksum is a hard failure -- see assertSha256.
  assertSha256(expectedSha256Hex, targetPath);

  // Idempotent fetch: if the file is already on disk and already hashes to the
  // expected sha256, there is nothing to download. This also allows a locally
  // built binary to be pre-placed at the target path (see
  // scripts/install-local-binaries.mjs and RUNBOOK-fieldtest.md).
  const existingSha256Hex = sha256OfFile(targetPath);
  if (existingSha256Hex === expectedSha256Hex) {
    console.log(
      `${targetPath} already present with the expected sha256 (${expectedSha256Hex}). Skipping download.`,
    );
    if (chmod) fs.chmodSync(targetPath, 511);
    return;
  }

  console.log('Downloading from', url);
  exec(`curl -f -L --output ${targetPath} ${url}`, (error, stdout, stderr) => {
    console.log(stdout);
    console.log(stderr);
    if (error !== null) {
      console.log('exec error: ' + error);
      throw new Error(`Failed to fetch resource from ${url}`);
    } else {
      const fileBytes = fs.readFileSync(targetPath);
      const hasher = crypto.createHash('sha256');
      hasher.update(fileBytes);
      const sha256Hex = hasher.digest('hex');
      if (sha256Hex !== expectedSha256Hex)
        throw new Error(
          `sha256 does not match the expected sha256 for ${targetPath} (from ${url}). Got ${sha256Hex} but expected ${expectedSha256Hex}`,
        );

      console.log('Download successful. sha256 of file (hex): ', sha256Hex);
      if (chmod) {
        fs.chmodSync(targetPath, 511);
        console.log('Gave executable permission to file.');
      }
    }
  });
}

export function downloadHolochainBinary(filename, withVersion = true, versionOverride = null) {
  const version = versionOverride ?? HOLOCHAIN_CHECKSUMS.version;
  const completeBinaryFilename = `${filename}-${ASSET_TARGET}`;
  const binaryFilenameWithVersion = `${filename}-v${version}${EXE_SUFFIX}`;
  const targetPath = path.join(
    binariesDir,
    withVersion ? binaryFilenameWithVersion : `${filename}${EXE_SUFFIX}`,
  );
  const { repo, tag } = binarySourceFor(filename, version);
  const holochainBinaryUrl = `https://github.com/${repo}/releases/download/${tag}/${completeBinaryFilename}`;
  downloadFile(holochainBinaryUrl, targetPath, expectedSha256For(filename), true);
}

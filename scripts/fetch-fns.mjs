import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import crypto from 'crypto';

const configJSON = fs.readFileSync('holochain-checksums.json');
const HOLOCHAIN_CHECKSUMS = JSON.parse(configJSON);

const binariesDir = path.join('resources', 'bins');
fs.mkdirSync(binariesDir, { recursive: true });

let targetEnding;
switch (process.platform) {
  case 'linux':
    switch (process.arch) {
      case 'arm64':
        targetEnding = 'aarch64-unknown-linux-gnu';
        break;
      case 'x64':
        targetEnding = 'x86_64-unknown-linux-gnu';
        break;
    }
    break;
  case 'win32':
    targetEnding = 'x86_64-pc-windows-msvc';
    break;
  case 'darwin':
    switch (process.arch) {
      case 'arm64':
        targetEnding = 'aarch64-apple-darwin';
        break;
      case 'x64':
        targetEnding = 'x86_64-apple-darwin';
        break;
      default:
        throw new Error(`Got unexpected macOS architecture: ${process.arch}`);
    }
    break;
  default:
    throw new Error(`Got unexpected OS platform: ${process.platform}`);
}

/**
 * sha256 (hex) of a file on disk, or null if the file does not exist.
 */
export function sha256OfFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const hasher = crypto.createHash('sha256');
  hasher.update(fs.readFileSync(filePath));
  return hasher.digest('hex');
}

export function downloadFile(url, targetPath, expectedSha256Hex, chmod = false) {
  // Idempotent fetch: if the file is already on disk and already hashes to the
  // expected sha256, there is nothing to download. This also allows a locally
  // built binary to be pre-placed at the target path (see
  // scripts/install-local-binaries.mjs and RUNBOOK-fieldtest.md).
  if (expectedSha256Hex) {
    const existingSha256Hex = sha256OfFile(targetPath);
    if (existingSha256Hex === expectedSha256Hex) {
      console.log(
        `${targetPath} already present with the expected sha256 (${expectedSha256Hex}). Skipping download.`,
      );
      if (chmod) fs.chmodSync(targetPath, 511);
      return;
    }
  }

  console.log('Downloading from', url);
  exec(`curl -f -L --output ${targetPath} ${url}`, (error, stdout, stderr) => {
    console.log(stdout);
    console.log(stderr);
    if (error !== null) {
      console.log('exec error: ' + error);
      throw new Error('Failed to fetch resource.');
    } else {
      const fileBytes = fs.readFileSync(targetPath);
      const hasher = crypto.createHash('sha256');
      hasher.update(fileBytes);
      const sha256Hex = hasher.digest('hex');
      if (expectedSha256Hex && sha256Hex !== expectedSha256Hex)
        throw new Error(
          `sha256 does not match the expected sha256. Got ${sha256Hex} but expected ${expectedSha256Hex}`,
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
  let completeBinaryFilename = `${filename}-${targetEnding}${process.platform === 'win32' ? '.exe' : ''}`;
  let binaryFilenameWithVersion = `${filename}-v${version}${process.platform === 'win32' ? '.exe' : ''}`;
  const targetPath = path.join(
    binariesDir,
    withVersion
      ? binaryFilenameWithVersion
      : `${filename}${process.platform === 'win32' ? '.exe' : ''}`,
  );
  const holochainBinaryUrl = `https://github.com/holochain/holochain/releases/download/holochain-${version}/${completeBinaryFilename}`;
  downloadFile(holochainBinaryUrl, targetPath, HOLOCHAIN_CHECKSUMS[filename][targetEnding], true);
}

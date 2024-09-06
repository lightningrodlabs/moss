import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import crypto from 'crypto';

const mossConfigJSON = fs.readFileSync(path.join('dist', 'main', 'moss.config.json'));
const mossConfig = JSON.parse(mossConfigJSON);

const binariesDir = path.join('dist', 'main', 'resources', 'bins');
fs.mkdirSync(binariesDir, { recursive: true });

let targetEnding;
switch (process.platform) {
  case 'linux':
    targetEnding = 'x86_64-unknown-linux-gnu';
    break;
  case 'win32':
    targetEnding = 'x86_64-pc-windows-msvc.exe';
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

const holochainBinaryFilename = `holochain-v${mossConfig.holochain.version}-${mossConfig.binariesAppendix}${
  process.platform === 'win32' ? '.exe' : ''
}`;

const lairBinaryFilename = `lair-keystore-v${mossConfig.lair.version}-${mossConfig.binariesAppendix}${
  process.platform === 'win32' ? '.exe' : ''
}`;

function downloadFile(url, targetPath, expectedSha256Hex) {
  exec(`curl -f -L --output ${targetPath} ${url}`, (error, stdout, stderr) => {
    console.log(stdout);
    console.log(stderr);
    if (error !== null) {
      console.log('exec error: ' + error);
      throw new Error('Failed to fetch resource.');
    }
  });

  const fileBytes = fs.readFileSync(targetPath);
  const hasher = crypto.createHash('sha256');
  hasher.update(fileBytes);
  const sha256Hex = hasher.digest('hex');
  if (sha256Hex !== expectedSha256Hex)
    throw new Error(
      `sha256 does not match the expected sha256. Got ${sha256Hex} but expected ${expectedSha256Hex}`,
    );

  console.log('Download successful. sha256 of file (hex): ', sha256Hex);
}

function downloadHolochainBinary() {
  const holochainBinaryRemoteFilename = `holochain-v${mossConfig.holochain.version}-${targetEnding}`;
  const holochainBinaryUrl = `https://github.com/matthme/holochain-binaries/releases/download/holochain-binaries-${mossConfig.holochain.version}/${holochainBinaryRemoteFilename}`;
  const destinationPath = path.join(binariesDir, holochainBinaryFilename);
  downloadFile(holochainBinaryUrl, destinationPath, mossConfig.holochain.sha256);
}

function downloadLairBinary() {
  const lairBinaryRemoteFilename = `lair-keystore-v${mossConfig.lair.version}-${targetEnding}`;
  const lairBinaryUrl = `https://github.com/matthme/holochain-binaries/releases/download/lair-binaries-${mossConfig.lair.version}/${lairBinaryRemoteFilename}`;
  const destinationPath = path.join(binariesDir, lairBinaryFilename);
  downloadFile(lairBinaryUrl, destinationPath, mossConfig.lair.sha256);
}

downloadHolochainBinary();
downloadLairBinary();

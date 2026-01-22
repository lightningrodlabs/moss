import * as fs from 'fs';
import * as path from 'path';
import {exec} from 'child_process';
import crypto from 'crypto';

const mossConfigJSON = fs.readFileSync('moss.config.json');
const mossConfig = JSON.parse(mossConfigJSON);

const binariesDir = path.join('resources', 'bins');
fs.mkdirSync(binariesDir, {recursive: true});

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


export function downloadFile(url, targetPath, expectedSha256Hex, chmod = false) {
  console.log('Downloading from ', url);
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


export function downloadHolochainBinary(binaryFilename) {
  let completeBinaryFilename = `${binaryFilename}-${targetEnding}${process.platform === 'win32' ? '.exe' : ''}`
  let completeBinaryFilenameWithVersion = `${binaryFilename}-v${mossConfig.holochain.version}-${targetEnding}${process.platform === 'win32' ? '.exe' : ''}`
  const targetPath = path.join(binariesDir, completeBinaryFilenameWithVersion);
  const holochainBinaryUrl = `https://github.com/holochain/holochain/releases/download/holochain-${mossConfig.holochain.version}/${completeBinaryFilename}`;
  downloadFile(
    holochainBinaryUrl,
    targetPath,
    mossConfig[binaryFilename].sha256[targetEnding],
    true,
  );
}

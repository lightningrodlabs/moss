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


function downloadFile(url, targetPath, expectedSha256Hex, chmod = false) {
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

function downloadHolochainBinary() {
  const holochainBinaryFilename = `holochain-v${mossConfig.holochain.version}-${mossConfig.binariesAppendix}${
    process.platform === 'win32' ? '.exe' : ''
  }`;
  const destinationPath = path.join(binariesDir, holochainBinaryFilename);
  const holochainBinaryRemoteFilename = `holochain-v${mossConfig.holochain.version}-${targetEnding}`;
  const holochainBinaryUrl = `https://github.com/matthme/holochain-binaries/releases/download/holochain-binaries-${mossConfig.holochain.version}/${holochainBinaryRemoteFilename}`;
  downloadFile(
    holochainBinaryUrl,
    destinationPath,
    mossConfig.holochain.sha256[targetEnding],
    true,
  );
}

function downloadLairBinary() {
  const lairConfig = mossConfig['lair-keystore'];
  const lairBinaryFilename = `lair-keystore-v${lairConfig.version}-${mossConfig.binariesAppendix}${
    process.platform === 'win32' ? '.exe' : ''
  }`;
  const destinationPath = path.join(binariesDir, lairBinaryFilename);
  const lairBinaryRemoteFilename = `lair-keystore-v${lairConfig.version}-${targetEnding}`;
  const lairBinaryUrl = `https://github.com/matthme/holochain-binaries/releases/download/lair-binaries-${lairConfig.version}/${lairBinaryRemoteFilename}`;
  downloadFile(lairBinaryUrl, destinationPath, lairConfig.sha256[targetEnding], true);
}

function downloadBootstrapBinary() {
  const bootstrapConfig = mossConfig['kitsune2-bootstrap-srv'];
  const bootstrapBinaryFilename = `kitsune2-bootstrap-srv-v${bootstrapConfig.version}-${mossConfig.binariesAppendix}${
    process.platform === 'win32' ? '.exe' : ''
  }`;
  const destinationPath = path.join(binariesDir, bootstrapBinaryFilename);
  const remoteFilename = `kitsune2-bootstrap-srv-v${bootstrapConfig.version}-${targetEnding}`;
  const binaryUrl = `https://github.com/matthme/holochain-binaries/releases/download/kitsune2-bootstrap-srv-binaries-${bootstrapConfig.version}/${remoteFilename}`;
  downloadFile(binaryUrl, destinationPath, bootstrapConfig.sha256[targetEnding], true);
}

downloadHolochainBinary();
downloadLairBinary();
downloadBootstrapBinary();

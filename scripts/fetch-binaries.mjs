import * as fs from 'fs';
import https from 'https';
import * as path from 'path';

const mossConfigJSON = fs.readFileSync('moss.config.json');
const mossConfig = JSON.parse(mossConfigJSON);

const binariesDir = path.join('resources', 'bins');

const holochainRemoteFilenames = {
  win32: `holochain-v${mossConfig.holochainVersion}-x86_64-pc-windows-msvc.exe `,
  darwin: `holochain-v${mossConfig.holochainVersion}-x86_64-apple-darwin `,
  linux: `holochain-v${mossConfig.holochainVersion}-x86_64-unknown-linux-gnu`,
};

const holochainBinaryFilename = `holochain-v${mossConfig.holochainVersion}${
  process.platform === 'win32' ? '.exe' : ''
}`;

const lairRemoteFilenames = {
  win32: `lair-keystore-v${mossConfig.lairVersion}-x86_64-pc-windows-msvc.exe `,
  darwin: `lair-keystore-v${mossConfig.lairVersion}-x86_64-apple-darwin `,
  linux: `lair-keystore-v${mossConfig.lairVersion}-x86_64-unknown-linux-gnu`,
};

const lairBinaryFilename = `lair-keystore-v${mossConfig.lairVersion}${
  process.platform === 'win32' ? '.exe' : ''
}`;

function downloadHolochainBinary() {
  const holochainBinaryRemoteFilename = holochainRemoteFilenames[process.platform];
  const holochainBinaryUrl = `https://github.com/matthme/holochain-binaries/releases/download/holochain-binaries-${mossConfig.holochainVersion}/${holochainBinaryRemoteFilename}`;

  const destinationPath = path.join(binariesDir, holochainBinaryFilename);

  const file = fs.createWriteStream(destinationPath);
  console.log('Fetching holochain binary from ', holochainBinaryUrl);
  https
    .get(holochainBinaryUrl, (response) => {
      if (response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        https.get(redirectUrl, (redirectResponse) => {
          redirectResponse.pipe(file);
        });
      } else {
        response.pipe(file);
      }

      file.on('finish', () => {
        file.close(() => {
          console.log('Holochain binary saved successfully.');
        });
      });

      fs.chmodSync(destinationPath, 511);
    })
    .on('error', (err) => {
      fs.unlink(destinationPath);
      console.error(err.message);
    });
}

function downloadLairBinary() {
  const lairBinaryRemoteFilename = lairRemoteFilenames[process.platform];
  const lairBinaryUrl = `https://github.com/matthme/holochain-binaries/releases/download/lair-binaries-${mossConfig.lairVersion}/${lairBinaryRemoteFilename}`;

  const destinationPath = path.join(binariesDir, lairBinaryFilename);

  const file = fs.createWriteStream(destinationPath);
  console.log('Fetching lair binary from ', lairBinaryFilename);
  https
    .get(lairBinaryUrl, (response) => {
      if (response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        https.get(redirectUrl, (redirectResponse) => {
          redirectResponse.pipe(file);
        });
      } else {
        response.pipe(file);
      }

      file.on('finish', () => {
        file.close(() => {
          console.log('Lair binary saved successfully.');
        });
      });

      fs.chmodSync(destinationPath, 511);
    })
    .on('error', (err) => {
      fs.unlink(destinationPath);
      console.error(err.message);
    });
}

downloadHolochainBinary();
downloadLairBinary();

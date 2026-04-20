import fs from 'fs';
import path from 'path';

const mossConfigJSON = fs.readFileSync('moss.config.json');
const mossConfig = JSON.parse(mossConfigJSON);

// Check whether holochain binary is in resources/bins folder
const binariesDirectory = path.join('resources', 'bins');
const expectedHolochainBinary = `holochain-v${mossConfig.holochain}${
  process.platform === 'win32' ? '.exe' : ''
}`;
if (!fs.existsSync(path.join(binariesDirectory, expectedHolochainBinary))) {
  const foundBinaries = fs.readdirSync(binariesDirectory);
  throw new Error(
    `Expected holochain binary '${expectedHolochainBinary}' not found. Available binaries in ./resources/bins:\n[${foundBinaries}]`,
  );
}

// Check whether lair binary is in the resources/bins folder
const expectedLairBinary = `lair-keystore-v${mossConfig.holochain}${
  process.platform === 'win32' ? '.exe' : ''
}`;
if (!fs.existsSync(path.join(binariesDirectory, expectedLairBinary))) {
  const foundBinaries = fs.readdirSync(binariesDirectory);
  throw new Error(
    `Expected lair binary '${expectedLairBinary}' not found. Available binaries in ./resources/bins:\n[${foundBinaries}]`,
  );
}

// Check whether whisper-server binary is in the resources/bins folder.
// Built by scripts/build-whisper-server.mjs from upstream source.
if (mossConfig.whisperServer) {
  const expectedWhisperBinary = `whisper-server-v${mossConfig.whisperServer}${
    process.platform === 'win32' ? '.exe' : ''
  }`;
  if (!fs.existsSync(path.join(binariesDirectory, expectedWhisperBinary))) {
    const foundBinaries = fs.readdirSync(binariesDirectory);
    throw new Error(
      `Expected whisper-server binary '${expectedWhisperBinary}' not found. Available binaries in ./resources/bins:\n[${foundBinaries}]`,
    );
  }
}

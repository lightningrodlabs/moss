import fs from 'fs';
import path from 'path';

const mossConfigJSON = fs.readFileSync('moss.config.json');
const mossConfig = JSON.parse(mossConfigJSON);

// Check whether holochain binary is in resources/bins folder
const binariesDirectory = path.join('resources', 'bins');
const expectedHolochainBinary = `holochain-v${mossConfig.holochainVersion}-${mossConfig.binariesAppendix}${
  process.platform === 'win32' ? '.exe' : ''
}`;
if (!fs.existsSync(path.join(binariesDirectory, expectedHolochainBinary))) {
  const foundBinaries = fs.readdirSync(binariesDirectory);
  throw new Error(
    `Expected holochain binary '${expectedHolochainBinary}' not found. Available binaries in ./resources/bins:\n[${foundBinaries}]`,
  );
}

// Check whether lair binary is in resources/bins folder
const expectedLairBinary = `lair-keystore-v${mossConfig.lairVersion}-${mossConfig.binariesAppendix}${
  process.platform === 'win32' ? '.exe' : ''
}`;
if (!fs.existsSync(path.join(binariesDirectory, expectedLairBinary))) {
  const foundBinaries = fs.readdirSync(binariesDirectory);

  throw new Error(
    `Expected lair binary '${expectedLairBinary}' not found. Available binaries in ./resources/bins:\n[${foundBinaries}]`,
  );
}

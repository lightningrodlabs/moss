import * as path from 'path'

const binariesDirectory = path.join(
  __dirname,
  // is relative to the directory where this file compiles to: out/main
  '../../resources/bins'
);

const holochianBinaries = {
  "holochain-0.2.3-beta-rc.1": path.join(binariesDirectory, "holochain-v0.2.3-beta-rc.1-x86_64-unknown-linux-gnu")
};

const lairBinary = path.join(binariesDirectory, "lair-keystore-v0.3.0-x86_64-unknown-linux-gnu");

export {
  holochianBinaries,
  lairBinary,
}


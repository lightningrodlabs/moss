import * as path from 'path';
import { app } from 'electron';

const binariesDirectory = app.isPackaged
  ? path.join(app.getAppPath(), '../app.asar.unpacked/resources/bins')
  : path.join(app.getAppPath(), './resources/bins');

const holochianBinaries = {
  'holochain-0.2.3-beta-rc.1': path.join(
    binariesDirectory,
    'holochain-v0.2.3-beta-rc.1-x86_64-unknown-linux-gnu',
  ),
};

const lairBinary = path.join(binariesDirectory, 'lair-keystore-v0.3.0-x86_64-unknown-linux-gnu');

export { holochianBinaries, lairBinary };

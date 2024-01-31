import * as path from 'path';
import { app } from 'electron';

const BINARIES_DIRECTORY = app.isPackaged
  ? path.join(app.getAppPath(), '../app.asar.unpacked/resources/bins')
  : path.join(app.getAppPath(), './resources/bins');

const HOLOCHAIN_BINARIES = {
  'holochain-v0.2.5-rc.1-8613839': path.join(
    BINARIES_DIRECTORY,
    `holochain-v0.2.5-rc.1-8613839${process.platform === 'win32' ? '.exe' : ''}`,
  ),
};

const LAIR_BINARY = path.join(
  BINARIES_DIRECTORY,
  `lair-keystore-v0.4.1${process.platform === 'win32' ? '.exe' : ''}`,
);

export { HOLOCHAIN_BINARIES, LAIR_BINARY };

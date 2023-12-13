import * as path from 'path';
import { app } from 'electron';

const BINARIES_DIRECTORY = app.isPackaged
  ? path.join(app.getAppPath(), '../app.asar.unpacked/resources/bins')
  : path.join(app.getAppPath(), './resources/bins');

const HOLOCHAIN_BINARIES = {
  'holochain-v0.2.4-rc.0': path.join(
    BINARIES_DIRECTORY,
    `holochain-v0.2.4-rc.0${process.platform === 'win32' ? '.exe' : ''}`,
  ),
};

const LAIR_BINARY = path.join(
  BINARIES_DIRECTORY,
  `lair-keystore-v0.3.0${process.platform === 'win32' ? '.exe' : ''}`,
);

export { HOLOCHAIN_BINARIES, LAIR_BINARY };

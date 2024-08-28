import path from 'path';
import { app } from 'electron';
import { MOSS_CONFIG } from './mossConfig';

const BINARIES_DIRECTORY = app.isPackaged
  ? path.join(app.getAppPath(), '../app.asar.unpacked/resources/bins')
  : path.join(app.getAppPath(), './resources/bins');

const HOLOCHAIN_BINARIES: Record<string, string> = {};
HOLOCHAIN_BINARIES[MOSS_CONFIG.holochain.version] = path.join(
  BINARIES_DIRECTORY,
  `holochain-v${MOSS_CONFIG.holochain.version}-${MOSS_CONFIG.binariesAppendix}${process.platform === 'win32' ? '.exe' : ''}`,
);

const LAIR_BINARY = path.join(
  BINARIES_DIRECTORY,
  `lair-keystore-v${MOSS_CONFIG.lair.version}-${MOSS_CONFIG.binariesAppendix}${process.platform === 'win32' ? '.exe' : ''}`,
);

console.log('MOSS_CONFIG: ', MOSS_CONFIG);
console.log('Holochain binaries: ', HOLOCHAIN_BINARIES);

export { HOLOCHAIN_BINARIES, LAIR_BINARY };

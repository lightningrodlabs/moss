import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The first one will be picked by default. But all production bootstrap servers should be listed
// here since there is a check to prevent accidental use of a production bootstrap server in development
// mode
export const PRODUCTION_BOOTSTRAP_URLS = [
  'https://dev-test-bootstrap2.holochain.org',
  'https://bootstrap.holo.host',
  'https://bootstrap-2.infra.holochain.org',
  'https://bootstrap-1.infra.holochain.org',
  'https://bootstrap-0.infra.holochain.org',
];
// The first one will be picked by default. But all production signaling servers should be listed
// here since there is a check to prevent accidental use of a production signaling server in development
// mode
export const PRODUCTION_SIGNALING_URLS = [
  'wss://dev-test-bootstrap2.holochain.org',
  'wss://sbd.holo.host',
  'wss://sbd-0.main.infra.holo.host',
  'wss://signal-2.infra.holochain.org',
  'wss://signal-1.infra.holochain.org',
  'wss://signal-0.infra.holochain.org',
  'wss://signal.holo.host',
];

const packageJsonPath = path.join(__dirname, '../package.json');
const packageJsonJSON = fs.readFileSync(packageJsonPath, 'utf-8');
export const PACKAGE_JSON = JSON.parse(packageJsonJSON);

const mossConfigPath = path.join(__dirname, 'moss.config.json');
const mossConfigJSON = fs.readFileSync(mossConfigPath, 'utf-8');
export const MOSS_CONFIG = JSON.parse(mossConfigJSON);
export const HOLOCHAIN_BINARY_NAME = `holochain-v${MOSS_CONFIG.holochain.version}-${MOSS_CONFIG.binariesAppendix}-wdocker${process.platform === 'win32' ? '.exe' : ''}`;

export const GROUP_HAPP_URL = `https://github.com/lightningrodlabs/moss/releases/download/group-happ-v${MOSS_CONFIG.groupHapp.version}/group.happ`;
// export const TOOLS_LIBRARY_URL = `https://github.com/lightningrodlabs/tools-library/releases/download/v${MOSS_CONFIG.toolsLibrary.version}/tools-library.happ`;
export const TOOLS_LIBRARY_URL = 'NOT_IN_USE';

export const DEFAULT_CHECK_INTERVAL_S = 300;

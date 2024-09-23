import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The first one will be picked by default. But all production bootstrap servers should be listed
// here since there is a check to prevent accidental use of a production bootstrap server in development
// mode
export const PRODUCTION_BOOTSTRAP_URLS = [
  'https://bootstrap.holo.host',
  'https://bootstrap-2.infra.holochain.org',
  'https://bootstrap-1.infra.holochain.org',
  'https://bootstrap-0.infra.holochain.org',
];
// The first one will be picked by default. But all production signaling servers should be listed
// here since there is a check to prevent accidental use of a production signaling server in development
// mode
export const PRODUCTION_SIGNALING_URLS = [
  'wss://sbd.holo.host',
  'wss://sbd-0.main.infra.holo.host',
  'wss://signal-2.infra.holochain.org',
  'wss://signal-1.infra.holochain.org',
  'wss://signal-0.infra.holochain.org',
  'wss://signal.holo.host',
];

const mossConfigPath = path.join(__dirname, 'moss.config.json');
const mossConfigJSON = fs.readFileSync(mossConfigPath, 'utf-8');
export const MOSS_CONFIG = JSON.parse(mossConfigJSON);

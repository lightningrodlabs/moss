import fs from 'fs';
import {
  downloadHolochainBinary,
} from './fetch-fns.mjs';

const mossConfig = JSON.parse(fs.readFileSync('moss.config.json', 'utf-8'));
const bootstrapSrvVersion = mossConfig.kitsune2BootstrapSrv ?? null;

downloadHolochainBinary("holochain");
downloadHolochainBinary("lair-keystore");
downloadHolochainBinary("kitsune2-bootstrap-srv", true, bootstrapSrvVersion);
downloadHolochainBinary("hc");

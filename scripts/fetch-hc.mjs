import {downloadHolochainBinary} from './fetch-fns.mjs';

downloadHolochainBinary("hc", false);

//import fs from "fs";
// const mossConfig = JSON.parse(fs.readFileSync('moss.config.json', 'utf-8'));
// const bootstrapSrvVersion = mossConfig.kitsune2BootstrapSrv ?? null;
// downloadHolochainBinary("kitsune2-bootstrap-srv", false, bootstrapSrvVersion);

import {downloadHolochainBinary} from './fetch-fns.mjs';
import fs from "fs";

downloadHolochainBinary("hc", false);

const mossConfig = JSON.parse(fs.readFileSync('moss.config.json', 'utf-8'));
const bootstrapSrvVersion = mossConfig.kitsune2BootstrapSrv ?? null;
downloadHolochainBinary("kitsune2-bootstrap-srv", false, bootstrapSrvVersion);

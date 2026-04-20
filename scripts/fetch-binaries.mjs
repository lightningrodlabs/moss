import fs from 'fs';
import { execSync } from 'child_process';
import {
  downloadHolochainBinary,
} from './fetch-fns.mjs';

const mossConfig = JSON.parse(fs.readFileSync('moss.config.json', 'utf-8'));
const bootstrapSrvVersion = mossConfig.kitsune2BootstrapSrv ?? null;

downloadHolochainBinary("holochain");
downloadHolochainBinary("lair-keystore");
downloadHolochainBinary("kitsune2-bootstrap-srv", true, bootstrapSrvVersion);
downloadHolochainBinary("hc");

// whisper-server is built from source on the runner rather than
// downloaded — upstream whisper.cpp has no prebuilt release artifacts.
// The script is idempotent (no-op if the binary is already present).
execSync('node ./scripts/build-whisper-server.mjs', { stdio: 'inherit' });

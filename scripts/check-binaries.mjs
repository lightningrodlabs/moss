import fs from 'fs';
import path from 'path';

const mossConfigJSON = fs.readFileSync('moss.config.json');
const mossConfig = JSON.parse(mossConfigJSON);

// Check whether holochain binary is in resources/bins folder
const binariesDirectory = path.join('resources', 'bins');
const expectedHolochainBinary = `holochain-v${mossConfig.holochain}${
  process.platform === 'win32' ? '.exe' : ''
}`;
if (!fs.existsSync(path.join(binariesDirectory, expectedHolochainBinary))) {
  const foundBinaries = fs.readdirSync(binariesDirectory);
  throw new Error(
    `Expected holochain binary '${expectedHolochainBinary}' not found. Available binaries in ./resources/bins:\n[${foundBinaries}]`,
  );
}

// Check whether lair binary is in the resources/bins folder
const expectedLairBinary = `lair-keystore-v${mossConfig.holochain}${
  process.platform === 'win32' ? '.exe' : ''
}`;
if (!fs.existsSync(path.join(binariesDirectory, expectedLairBinary))) {
  const foundBinaries = fs.readdirSync(binariesDirectory);
  throw new Error(
    `Expected lair binary '${expectedLairBinary}' not found. Available binaries in ./resources/bins:\n[${foundBinaries}]`,
  );
}

// ASR checks (whisper-server binary + bundled model) are opt-in via
// MOSS_REQUIRE_ASR=1 (`yarn check:binaries:release`). Plain `yarn setup`
// does not build whisper-server — that needs cmake and a C++ toolchain —
// and dev mode resolves the binary through a nix-shell fallback (see
// src/main/asr/binaryResolver.ts), so `yarn applet-dev-*` runs the
// plain check. `setup:release` and the packaging scripts run the strict
// variant so a release never ships without the sidecar and model.
if (process.env.MOSS_REQUIRE_ASR === '1') {
  if (mossConfig.whisperServer) {
    const expectedWhisperBinary = `whisper-server-v${mossConfig.whisperServer}${
      process.platform === 'win32' ? '.exe' : ''
    }`;
    if (!fs.existsSync(path.join(binariesDirectory, expectedWhisperBinary))) {
      const foundBinaries = fs.readdirSync(binariesDirectory);
      throw new Error(
        `Expected whisper-server binary '${expectedWhisperBinary}' not found. Available binaries in ./resources/bins:\n[${foundBinaries}]`,
      );
    }
  }

  const modelPath = path.join('resources', 'models', 'ggml-base.en.bin');
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Expected ASR model at '${modelPath}' (run \`yarn fetch:asr-model\`).`);
  }
}

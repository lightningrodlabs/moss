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
// MOSS_REQUIRE_ASR=1. Dev mode uses a nix-shell fallback for the
// binary (see src/main/asr/binaryResolver.ts) and the spike model, so
// enforcing their presence would break `yarn applet-dev-*` for any
// developer who skipped the ASR build on setup. Release CI flips the
// flag on in yarn setup:release.
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
    throw new Error(
      `Expected ASR model at '${modelPath}' (run \`yarn fetch:asr-model\`).`,
    );
  }
}

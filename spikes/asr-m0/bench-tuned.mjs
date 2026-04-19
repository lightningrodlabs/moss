#!/usr/bin/env node
// Benchmark smart-whisper with various param combinations on the JFK
// sample, to find the source of the perf gap vs Presence's whisper-cli
// numbers (29× RT on tiny.en) and decide whether smart-whisper can
// compete.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Whisper } from 'smart-whisper';
import { bufferToFloat32, SAMPLE_RATE } from './lib/audio.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const WHISPER_SAMPLING_GREEDY = 0;
const WHISPER_SAMPLING_BEAM = 1;

const SAMPLE = resolve(HERE, 'samples/jfk.wav');

const MODELS = {
  'tiny.en': resolve(HERE, 'models/ggml-tiny.en.bin'),
  'base.en': resolve(HERE, 'models/ggml-base.en.bin'),
};

const CONFIGS = [
  { label: 'beam, default threads (smart-whisper default)', strategy: WHISPER_SAMPLING_BEAM },
  { label: 'greedy, default threads', strategy: WHISPER_SAMPLING_GREEDY },
  { label: 'greedy, n_threads=4', strategy: WHISPER_SAMPLING_GREEDY, n_threads: 4 },
  { label: 'greedy, n_threads=8', strategy: WHISPER_SAMPLING_GREEDY, n_threads: 8 },
  { label: 'beam, n_threads=8', strategy: WHISPER_SAMPLING_BEAM, n_threads: 8 },
];

const audio = bufferToFloat32(await readFile(SAMPLE));
const audioMs = (audio.length / SAMPLE_RATE) * 1000;
console.log(`audio: ${audioMs.toFixed(0)} ms\n`);

for (const [modelName, modelPath] of Object.entries(MODELS)) {
  let whisper;
  try {
    whisper = new Whisper(modelPath, { gpu: false });
  } catch (e) {
    console.log(`[skip ${modelName}: ${e.message}]\n`);
    continue;
  }

  // warmup
  const warm = await whisper.transcribe(audio, { language: 'en' });
  await warm.result;

  console.log(`# ${modelName}`);
  for (const cfg of CONFIGS) {
    const t0 = performance.now();
    const task = await whisper.transcribe(audio, { language: 'en', ...cfg });
    let text = '';
    task.on('transcribed', (s) => { text += s.text; });
    await task.result;
    const dt = performance.now() - t0;
    const rtf = dt / audioMs;
    console.log(`  ${cfg.label.padEnd(46)} ${dt.toFixed(0).padStart(6)} ms  RTF ${rtf.toFixed(3)}  (${(1/rtf).toFixed(1)}× RT)`);
  }
  await whisper.free();
  console.log();
}

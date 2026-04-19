#!/usr/bin/env node
// Batch harness: read a WAV file or raw PCM16 mono @ 16 kHz from stdin,
// transcribe with whisper, emit JSON-lines `final` events to stdout.
//
// Usage:
//   node harness-batch.mjs path/to/file.wav
//   node harness-batch.mjs -                # read stdin

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Whisper } from 'smart-whisper';
import { bufferToFloat32, readAll, SAMPLE_RATE } from './lib/audio.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = process.env.MOSS_ASR_MODEL ?? resolve(HERE, 'models/ggml-tiny.en.bin');

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function emitError(message) {
  emit({ type: 'error', error: message });
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    emitError('usage: harness-batch.mjs <file.wav | ->');
    process.exit(2);
  }

  const buf = arg === '-' ? await readAll(process.stdin) : await readFile(arg);
  const audio = bufferToFloat32(buf);

  const tLoadStart = performance.now();
  const whisper = new Whisper(MODEL_PATH, { gpu: false });
  const tLoadEnd = performance.now();

  emit({
    type: 'capabilities',
    model: 'ggml-tiny.en',
    sampleRate: SAMPLE_RATE,
    streaming: false,
    loadMs: Math.round(tLoadEnd - tLoadStart),
    audioMs: Math.round((audio.length / SAMPLE_RATE) * 1000),
  });

  const tInferStart = performance.now();
  const task = await whisper.transcribe(audio, {
    language: 'en',
    suppress_blank: true,
  });

  // smart-whisper TranscribeTask emits 'transcribed' per-segment and
  // 'finish' at the end. Segment shape: { from, to, text } with from/to
  // already in milliseconds.
  task.on('transcribed', (seg) => {
    emit({
      type: 'final',
      text: seg.text.trim(),
      tStart: seg.from,
      tEnd: seg.to,
    });
  });

  await task.result; // resolves when 'finish' fires
  const tInferEnd = performance.now();

  emit({
    type: 'stats',
    inferMs: Math.round(tInferEnd - tInferStart),
    realtimeFactor:
      Math.round(((audio.length / SAMPLE_RATE) * 1000) / (tInferEnd - tInferStart) * 100) / 100,
  });

  await whisper.free();
}

main().catch((err) => {
  emitError(err?.stack ?? String(err));
  process.exit(1);
});

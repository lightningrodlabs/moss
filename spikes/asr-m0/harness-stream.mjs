#!/usr/bin/env node
// Streaming harness: read raw PCM16 mono @ 16 kHz from stdin in
// arbitrary chunks. Buffer into ~3 s windows with 0.5 s overlap, run
// whisper on each window, emit `partial` events for the in-progress
// window and `final` events when a window commits.
//
// This is the shape M1's Moss-side broker will sit on top of. The VAD
// here is dumb-fixed-window; M1 should swap in something smarter (Silero
// VAD, energy-based, or whatever).

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Whisper } from 'smart-whisper';
import { pcm16ToFloat32Mono, SAMPLE_RATE } from './lib/audio.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = process.env.MOSS_ASR_MODEL ?? resolve(HERE, 'models/ggml-tiny.en.bin');

const WINDOW_SEC = 3.0;
const OVERLAP_SEC = 0.5;
const WINDOW_SAMPLES = Math.round(WINDOW_SEC * SAMPLE_RATE);
const OVERLAP_SAMPLES = Math.round(OVERLAP_SEC * SAMPLE_RATE);
const COMMIT_SAMPLES = WINDOW_SAMPLES - OVERLAP_SAMPLES;

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function emitError(message) {
  emit({ type: 'error', error: message });
}

async function main() {
  const tLoadStart = performance.now();
  const whisper = new Whisper(MODEL_PATH, { gpu: false });
  const tLoadEnd = performance.now();

  emit({
    type: 'capabilities',
    model: 'ggml-tiny.en',
    sampleRate: SAMPLE_RATE,
    streaming: 'emulated',
    windowSec: WINDOW_SEC,
    overlapSec: OVERLAP_SEC,
    loadMs: Math.round(tLoadEnd - tLoadStart),
  });

  // Float32 ring of samples not yet committed.
  let pending = new Float32Array(0);
  let sessionSampleCursor = 0; // total committed samples so far

  async function transcribeWindow(window, isFinal) {
    const tStart = performance.now();
    const task = await whisper.transcribe(window, {
      language: 'en',
      suppress_blank: true,
    });
    let text = '';
    task.on('transcribed', (seg) => {
      text += seg.text;
    });
    await task.result;
    text = text.trim();
    const tEnd = performance.now();
    const offsetMs = Math.round((sessionSampleCursor / SAMPLE_RATE) * 1000);
    const durMs = Math.round((window.length / SAMPLE_RATE) * 1000);
    emit({
      type: isFinal ? 'final' : 'partial',
      text,
      tStart: offsetMs,
      tEnd: offsetMs + durMs,
      inferMs: Math.round(tEnd - tStart),
    });
  }

  process.stdin.on('data', async (chunk) => {
    if (chunk.length % 2 !== 0) {
      emitError('PCM16 chunk has odd byte length');
      return;
    }
    const int16 = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2);
    const f32 = pcm16ToFloat32Mono(int16, SAMPLE_RATE, 1);
    const merged = new Float32Array(pending.length + f32.length);
    merged.set(pending, 0);
    merged.set(f32, pending.length);
    pending = merged;

    while (pending.length >= WINDOW_SAMPLES) {
      const window = pending.slice(0, WINDOW_SAMPLES);
      // Commit COMMIT_SAMPLES; keep OVERLAP_SAMPLES around to bridge into
      // the next window so we don't slice a word at the boundary.
      pending = pending.slice(COMMIT_SAMPLES);
      try {
        await transcribeWindow(window, true);
        sessionSampleCursor += COMMIT_SAMPLES;
      } catch (e) {
        emitError(e?.stack ?? String(e));
      }
    }
  });

  process.stdin.on('end', async () => {
    if (pending.length > 0) {
      try {
        await transcribeWindow(pending, true);
        sessionSampleCursor += pending.length;
      } catch (e) {
        emitError(e?.stack ?? String(e));
      }
    }
    await whisper.free();
    emit({ type: 'session-end' });
  });

  process.stdin.on('error', (e) => emitError(e?.stack ?? String(e)));
}

main().catch((err) => {
  emitError(err?.stack ?? String(err));
  process.exit(1);
});

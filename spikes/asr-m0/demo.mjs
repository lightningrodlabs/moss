#!/usr/bin/env node
// One-shot end-to-end demo. Runs the bundled JFK sample through the
// batch harness and the streaming harness and prints a small summary.
// No ffmpeg required.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bufferToFloat32, parseWavHeader, SAMPLE_RATE } from './lib/audio.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PATH = resolve(HERE, 'samples/jfk.wav');

async function runBatch() {
  return new Promise((res, rej) => {
    const events = [];
    const proc = spawn(process.execPath, [resolve(HERE, 'harness-batch.mjs'), SAMPLE_PATH], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let leftover = '';
    proc.stdout.on('data', (chunk) => {
      leftover += chunk.toString('utf8');
      const lines = leftover.split('\n');
      leftover = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) events.push(JSON.parse(line));
      }
    });
    proc.on('exit', (code) => (code === 0 ? res(events) : rej(new Error(`batch exit ${code}`))));
    proc.on('error', rej);
  });
}

async function runStream() {
  // Re-encode the bundled WAV as raw PCM16 mono @ 16 kHz and stream it
  // to harness-stream over stdin in 200 ms chunks (simulating the
  // cadence a tool would push at).
  const buf = await readFile(SAMPLE_PATH);
  const { sampleRate, channels, dataOffset, dataLength } = parseWavHeader(buf);
  if (sampleRate !== SAMPLE_RATE || channels !== 1) {
    // Resample via the helper, then re-pack to Int16 raw PCM16
    const f32 = bufferToFloat32(buf);
    const int16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      int16[i] = s < 0 ? s * 32768 : s * 32767;
    }
    return runStreamWithRawPcm(Buffer.from(int16.buffer));
  }
  const raw = Buffer.from(buf.buffer, buf.byteOffset + dataOffset, dataLength);
  return runStreamWithRawPcm(raw);
}

async function runStreamWithRawPcm(raw) {
  return new Promise((res, rej) => {
    const events = [];
    const proc = spawn(process.execPath, [resolve(HERE, 'harness-stream.mjs')], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let leftover = '';
    proc.stdout.on('data', (chunk) => {
      leftover += chunk.toString('utf8');
      const lines = leftover.split('\n');
      leftover = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) events.push(JSON.parse(line));
      }
    });
    proc.on('exit', (code) => (code === 0 ? res(events) : rej(new Error(`stream exit ${code}`))));
    proc.on('error', rej);

    // Push 200 ms chunks (= 6400 samples = 12 800 bytes of PCM16) with
    // a tiny delay so it actually behaves like a stream.
    const CHUNK = 200 * (SAMPLE_RATE / 1000) * 2; // bytes
    let off = 0;
    const tick = () => {
      if (off >= raw.length) {
        proc.stdin.end();
        return;
      }
      const slice = raw.subarray(off, Math.min(off + CHUNK, raw.length));
      proc.stdin.write(slice);
      off += slice.length;
      setTimeout(tick, 50); // faster than realtime so demo is quick
    };
    tick();
  });
}

console.log('--- batch harness ---');
const batch = await runBatch();
for (const ev of batch) console.log(JSON.stringify(ev));

console.log('\n--- streaming harness ---');
const stream = await runStream();
for (const ev of stream) console.log(JSON.stringify(ev));

const batchStats = batch.find((e) => e.type === 'stats');
const batchFinals = batch.filter((e) => e.type === 'final').map((e) => e.text).join(' ');
const streamFinals = stream.filter((e) => e.type === 'final').map((e) => e.text).join(' ');

console.log('\n--- summary ---');
console.log(`Batch transcript:    ${batchFinals}`);
console.log(`Streaming transcript: ${streamFinals}`);
if (batchStats) {
  console.log(`Batch realtime factor: ${batchStats.realtimeFactor}× (>1 = faster than realtime)`);
}

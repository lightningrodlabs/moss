#!/usr/bin/env node
// Download a small whisper model + the JFK sample for the demo harness.
// HuggingFace hosts the official ggml weights for whisper.cpp.

import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = resolve(HERE, 'models');
const SAMPLES_DIR = resolve(HERE, 'samples');

const ASSETS = [
  {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    path: join(MODELS_DIR, 'ggml-tiny.en.bin'),
    expectMin: 70 * 1024 * 1024, // ~75 MB
  },
  {
    url: 'https://github.com/ggerganov/whisper.cpp/raw/master/samples/jfk.wav',
    path: join(SAMPLES_DIR, 'jfk.wav'),
    expectMin: 100 * 1024,
  },
];

mkdirSync(MODELS_DIR, { recursive: true });
mkdirSync(SAMPLES_DIR, { recursive: true });

for (const asset of ASSETS) {
  if (existsSync(asset.path) && statSync(asset.path).size >= asset.expectMin) {
    console.log(`✓ already present: ${asset.path}`);
    continue;
  }
  console.log(`↓ fetching: ${asset.url}`);
  const res = await fetch(asset.url);
  if (!res.ok || !res.body) {
    throw new Error(`fetch failed for ${asset.url}: ${res.status} ${res.statusText}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(asset.path));
  const size = statSync(asset.path).size;
  console.log(`  → wrote ${size.toLocaleString()} bytes to ${asset.path}`);
  if (size < asset.expectMin) {
    throw new Error(`downloaded asset smaller than expected (${size} < ${asset.expectMin})`);
  }
}

console.log('done.');

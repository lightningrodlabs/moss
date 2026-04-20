#!/usr/bin/env node
// Downloads the default ggml whisper model into resources/models/ so
// the installer ships with an ASR model out of the box. v1 choice is
// ggml-base.en (~141 MB, English only, good speed/quality tradeoff on
// CPU — see spikes/asr-m0/RESULTS.md).
//
// Model-download UX in-app (choose tier, show progress, resume, etc.)
// is explicitly deferred per MOSS_LOCAL_MODELS_PLAN.md. Bundling
// trades installer size for a test cohort that "just works".
//
// Idempotent: skips if the file is already present and the expected
// size matches. Verifies sha256 if EXPECTED_SHA256 is known; otherwise
// falls back to minimum-size check (HuggingFace hashes can lag model
// republishes).

import crypto from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const MODEL_FILENAME = 'ggml-base.en.bin';
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILENAME}`;
// SHA-256 of the official ggml-base.en.bin as hosted on HuggingFace
// (verified 2026-04-20, size 147,964,211 bytes). Release CI aborts on
// mismatch so we notice if upstream republishes the file.
const EXPECTED_SHA256 = 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002';
const MIN_SIZE_BYTES = 140 * 1024 * 1024; // ~141 MB; guard against truncated downloads

const MODELS_DIR = join(REPO_ROOT, 'resources', 'models');
const TARGET_PATH = join(MODELS_DIR, MODEL_FILENAME);

mkdirSync(MODELS_DIR, { recursive: true });

if (existsSync(TARGET_PATH)) {
  const size = statSync(TARGET_PATH).size;
  if (size >= MIN_SIZE_BYTES) {
    console.log(`✓ already present: ${TARGET_PATH} (${size.toLocaleString()} bytes)`);
    process.exit(0);
  }
  console.log(`↻ existing file too small (${size} < ${MIN_SIZE_BYTES}); re-downloading`);
}

console.log(`↓ fetching ${MODEL_URL}`);
const res = await fetch(MODEL_URL);
if (!res.ok || !res.body) {
  throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
}
await pipeline(Readable.fromWeb(res.body), createWriteStream(TARGET_PATH));

const size = statSync(TARGET_PATH).size;
console.log(`  wrote ${size.toLocaleString()} bytes`);
if (size < MIN_SIZE_BYTES) {
  throw new Error(`downloaded file smaller than expected (${size} < ${MIN_SIZE_BYTES})`);
}

if (EXPECTED_SHA256 && !EXPECTED_SHA256.startsWith('<')) {
  const hasher = crypto.createHash('sha256');
  hasher.update(readFileSync(TARGET_PATH));
  const actual = hasher.digest('hex');
  if (actual !== EXPECTED_SHA256) {
    throw new Error(
      `sha256 mismatch for ${MODEL_FILENAME}: expected ${EXPECTED_SHA256}, got ${actual}`,
    );
  }
  console.log(`✓ sha256 verified: ${actual}`);
}

console.log(`✓ installed: ${TARGET_PATH}`);

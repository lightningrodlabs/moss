#!/usr/bin/env node
// Sidecar harness: spawn whisper-server (whisper.cpp) once, keep model
// loaded, POST WAV chunks for inference, parse JSON results.
//
// Usage:
//   node harness-sidecar.mjs path/to/file.wav
//
// This is the architecture we'd actually ship if M1 picks the sidecar
// path. The model lives in a separate process (utilityProcess in
// shipping Moss), so model OOM doesn't take down Moss main.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL = process.env.MOSS_ASR_MODEL ?? resolve(HERE, 'models/ggml-base.en.bin');
const PORT = 8765;

function emit(o) { process.stdout.write(JSON.stringify(o) + '\n'); }

async function waitForServer(url, timeoutMs = 30_000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`whisper-server did not become ready within ${timeoutMs} ms`);
}

async function main() {
  const wav = process.argv[2];
  if (!wav) {
    emit({ type: 'error', error: 'usage: harness-sidecar.mjs <file.wav>' });
    process.exit(2);
  }

  const tSpawn = performance.now();
  const proc = spawn(
    'nix',
    [
      'shell', 'nixpkgs#whisper-cpp', '-c', 'whisper-server',
      '-m', MODEL,
      '--host', '127.0.0.1',
      '--port', String(PORT),
      '-t', '4',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  // Capture but suppress server logs unless they crash; surface stderr
  // tail on exit.
  const stderr = [];
  proc.stderr.on('data', (b) => stderr.push(b));
  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(Buffer.concat(stderr).toString('utf8').slice(-2000));
    }
  });

  try {
    await waitForServer(`http://127.0.0.1:${PORT}/`, 60_000);
    const tReady = performance.now();
    emit({
      type: 'capabilities',
      runtime: 'whisper.cpp/whisper-server (sidecar)',
      model: 'ggml-base.en',
      readyMs: Math.round(tReady - tSpawn),
    });

    const audioBuf = await readFile(wav);
    const tInfer = performance.now();

    // whisper-server expects a multipart/form-data POST to /inference
    // with a "file" field. Build the multipart body by hand to avoid
    // pulling in a deps library.
    const boundary = '----moss-asr-spike-' + Date.now();
    const head = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
        `Content-Type: audio/wav\r\n\r\n`,
    );
    const tail = Buffer.from(
      `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n` +
        `--${boundary}--\r\n`,
    );
    const body = Buffer.concat([head, audioBuf, tail]);

    const res = await fetch(`http://127.0.0.1:${PORT}/inference`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const tDone = performance.now();
    if (!res.ok) {
      throw new Error(`inference HTTP ${res.status}: ${await res.text()}`);
    }
    const json = await res.json();

    if (Array.isArray(json.segments)) {
      for (const seg of json.segments) {
        emit({
          type: 'final',
          text: (seg.text ?? '').trim(),
          tStart: Math.round((seg.t0 ?? seg.start ?? 0) * 10),
          tEnd: Math.round((seg.t1 ?? seg.end ?? 0) * 10),
        });
      }
    } else if (typeof json.text === 'string') {
      emit({ type: 'final', text: json.text.trim(), tStart: 0, tEnd: 0 });
    }

    emit({
      type: 'stats',
      readyMs: Math.round(tReady - tSpawn),
      inferMs: Math.round(tDone - tInfer),
    });
  } finally {
    proc.kill('SIGTERM');
  }
}

main().catch((err) => {
  emit({ type: 'error', error: err?.stack ?? String(err) });
  process.exit(1);
});

// Integration test for WhisperServer.
//
// Requires a real whisper-server binary and a real model on disk.
// The test resolves both via env vars with sensible defaults pointing at
// the M0 spike artifacts. If neither is present the test is skipped
// (with a clear message) rather than failed — CI without the binaries
// should not be a hard failure here.
//
// Required state to run end-to-end:
//   - `whisper-server` reachable via $MOSS_WHISPER_SERVER_CMD (space-
//      separated, e.g. `nix shell <pinned nixpkgs>#whisper-cpp -c whisper-server`)
//      OR available via the default fallback
//      `nix shell <pinned nixpkgs>#whisper-cpp -c whisper-server`
//   - A ggml model file at $MOSS_WHISPER_MODEL or the M0 spike default
//      `spikes/asr-m0/models/ggml-base.en.bin`
//   - A WAV sample at $MOSS_WHISPER_SAMPLE or `spikes/asr-m0/samples/jfk.wav`

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { NIX_WHISPER_FLAKE_REF } from '../binaryResolver';
import { buildInferenceBody, WhisperServer, WhisperServerStartError } from '../whisperServer';

const REPO_ROOT = resolve(__dirname, '../../../..');
const DEFAULT_MODEL = resolve(REPO_ROOT, 'spikes/asr-m0/models/ggml-base.en.bin');
const DEFAULT_SAMPLE = resolve(REPO_ROOT, 'spikes/asr-m0/samples/jfk.wav');
const DEFAULT_CMD = `nix shell ${NIX_WHISPER_FLAKE_REF} -c whisper-server`;

function resolveCommand(): readonly string[] {
  const raw = process.env.MOSS_WHISPER_SERVER_CMD ?? DEFAULT_CMD;
  return raw.split(/\s+/).filter(Boolean);
}

function modelPath(): string {
  return process.env.MOSS_WHISPER_MODEL ?? DEFAULT_MODEL;
}

function samplePath(): string {
  return process.env.MOSS_WHISPER_SAMPLE ?? DEFAULT_SAMPLE;
}

function preflightOk(): { ok: true } | { ok: false; reason: string } {
  if (!existsSync(modelPath())) {
    return { ok: false, reason: `model missing at ${modelPath()} (run spikes/asr-m0 fetch-model)` };
  }
  if (!existsSync(samplePath())) {
    return { ok: false, reason: `sample missing at ${samplePath()}` };
  }
  return { ok: true };
}

describe('WhisperServer', () => {
  const pre = preflightOk();
  const maybe = pre.ok ? it : it.skip;
  if (!pre.ok) {
    // Surface the skip reason without failing the suite.
    // eslint-disable-next-line no-console
    console.warn(`[whisperServer.test] skipping integration tests: ${pre.reason}`);
  }

  maybe(
    'spawns, transcribes the JFK sample correctly, and stops',
    async () => {
      const server = new WhisperServer({
        command: resolveCommand(),
        modelPath: modelPath(),
        threads: 4,
      });
      try {
        expect(server.state).toBe('idle');
        await server.start();
        expect(server.state).toBe('ready');
        expect(server.port).toBeGreaterThan(0);

        const wav = readFileSync(samplePath());
        const result = await server.transcribe(wav);

        const text = result.segments
          .map((s) => s.text)
          .join(' ')
          .toLowerCase();
        expect(text).toMatch(/fellow americans/);
        expect(text).toMatch(/your country/);
        expect(result.inferMs).toBeGreaterThan(0);
        expect(result.segments.length).toBeGreaterThan(0);
        for (const seg of result.segments) {
          expect(seg.tEnd).toBeGreaterThanOrEqual(seg.tStart);
        }
      } finally {
        await server.stop();
        expect(server.state).toBe('stopped');
      }
    },
    120_000,
  );

  it('rejects start() with a start error when the binary cannot be spawned', async () => {
    const server = new WhisperServer({
      command: ['/nonexistent/dir/whisper-server-does-not-exist'],
      modelPath: '/dev/null',
      startTimeoutMs: 5_000,
    });
    const t0 = Date.now();
    await expect(server.start()).rejects.toThrow(WhisperServerStartError);
    // A spawn failure must surface immediately, not after the readiness timeout.
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(server.state).toBe('stopped');
    await server.stop(); // no throw on a server that never spawned
  });

  it('rejects transcribe() before start()', async () => {
    const server = new WhisperServer({
      command: ['whisper-server'],
      modelPath: '/dev/null',
    });
    await expect(server.transcribe(Buffer.alloc(0))).rejects.toThrow(/not ready/);
  });

  it('rejects start() if called twice', async () => {
    const server = new WhisperServer({
      command: ['whisper-server'],
      modelPath: '/dev/null',
    });
    // Force-flip state so we don't actually try to spawn anything in
    // this unit-only assertion. Cast through unknown to reach the
    // private field — acceptable in tests for state-machine assertions.
    (server as unknown as { _state: string })._state = 'ready';
    await expect(server.start()).rejects.toThrow(/only valid from 'idle'/);
  });

  it('stop() is a no-op on an idle server', async () => {
    const server = new WhisperServer({
      command: ['whisper-server'],
      modelPath: '/dev/null',
    });
    await server.stop();
    expect(server.state).toBe('stopped');
  });
});

describe('buildInferenceBody', () => {
  it('sends the WAV as `file` plus one form part per extra field', () => {
    const wav = Buffer.from('RIFFdata');
    const body = buildInferenceBody('bnd', wav, {
      response_format: 'verbose_json',
      language: 'de',
    });
    const text = body.toString('latin1');
    expect(text).toContain('name="file"; filename="audio.wav"');
    expect(text).toContain('RIFFdata');
    expect(text).toContain('name="response_format"\r\n\r\nverbose_json');
    expect(text).toContain('name="language"\r\n\r\nde');
    expect(text.endsWith('--bnd--\r\n')).toBe(true);
  });

  it('omits fields whose value is undefined', () => {
    const body = buildInferenceBody('bnd', Buffer.alloc(0), { language: undefined });
    expect(body.toString('latin1')).not.toContain('name="language"');
  });
});

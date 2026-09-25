// Offline replay of a recorded microphone capture through the real
// AsrSession and a real whisper-server, with the options Presence uses.
// Skipped unless ASR_REPLAY_WAV names a PCM16 WAV (for example the
// presence-mic-*.wav a Presence session downloads when
// localStorage.transcriptionDebugRecord is set).
//
//   ASR_REPLAY_WAV=~/Downloads/presence-mic-....wav \
//   ASR_REPLAY_OUT=/tmp/asr-replay \
//   yarn vitest run src/main/asr/__tests__/replay.test.ts
//
// Every commit is dumped under ASR_REPLAY_OUT, so
// `yarn asr:diagnose <out> --reference <wav>` compares the replayed
// commits against the recording.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AsrSession } from '../session';
import { NIX_WHISPER_FLAKE_REF } from '../binaryResolver';
import { WhisperServer } from '../whisperServer';

const REPO_ROOT = resolve(__dirname, '../../../..');
const DEFAULT_MODEL = resolve(REPO_ROOT, 'resources/models/ggml-base.en.bin');
const DEFAULT_CMD = `nix shell ${NIX_WHISPER_FLAKE_REF} -c whisper-server`;
const FRAME_MS = 10;

function readPcm16Wav(path: string): { sampleRate: number; channels: 1 | 2; pcm: Int16Array } {
  const buf = readFileSync(path);
  let offset = 12;
  let sampleRate = 0;
  let channels = 1;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
    } else if (id === 'data') {
      const pcm = new Int16Array(Math.floor(Math.min(size, buf.length - body) / 2));
      for (let i = 0; i < pcm.length; i++) pcm[i] = buf.readInt16LE(body + i * 2);
      return { sampleRate, channels: channels === 2 ? 2 : 1, pcm };
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`${path}: no data chunk`);
}

const wavPath = process.env.ASR_REPLAY_WAV;
const maybe = wavPath && existsSync(wavPath) ? it : it.skip;

describe('ASR replay of a recorded capture', () => {
  maybe(
    'commits the recording through the real session and whisper-server',
    async () => {
      const outDir = process.env.ASR_REPLAY_OUT ?? resolve(tmpdir(), 'asr-replay');
      mkdirSync(outDir, { recursive: true });
      process.env.MOSS_ASR_DUMP_DIR = outDir;

      const { sampleRate, channels, pcm } = readPcm16Wav(wavPath!);
      const server = new WhisperServer({
        command: (process.env.MOSS_WHISPER_SERVER_CMD ?? DEFAULT_CMD).split(/\s+/),
        modelPath: process.env.MOSS_WHISPER_MODEL ?? DEFAULT_MODEL,
        threads: 4,
      });
      await server.start();
      const finals: string[] = [];
      try {
        const session = new AsrSession(server, () => {}, {
          language: 'en',
          sampleRate,
          channels,
          vadSilenceMs: 600,
        });
        session.onFinal((ev) => finals.push(`[${ev.tStart}-${ev.tEnd}ms] ${ev.text}`));
        session.onError((err) => finals.push(`ERROR ${err.message}`));

        const frame = Math.round((sampleRate * channels * FRAME_MS) / 1000);
        for (let at = 0; at < pcm.length; at += frame) {
          await session.pushAudio(pcm.subarray(at, Math.min(at + frame, pcm.length)), false);
        }
        await session.pushAudio(new Int16Array(0), true);
        await session.close();
      } finally {
        await server.stop();
      }
      process.stdout.write(
        `\nreplayed ${wavPath} (${(pcm.length / channels / sampleRate).toFixed(1)}s)\n`,
      );
      for (const f of finals) process.stdout.write(`  ${f}\n`);
      process.stdout.write(`dumps in ${outDir}\n`);
      expect(finals.length).toBeGreaterThan(0);
      expect(finals.some((f) => f.startsWith('ERROR'))).toBe(false);
    },
    300_000,
  );
});

#!/usr/bin/env node
// Diagnose dropped speech in a Moss ASR session.
//
// Run Moss with MOSS_ASR_DUMP_DIR=<dir> (and MOSS_ASR_DEBUG=1 for the
// live trace). Every commit the session sends to whisper lands in <dir>
// as a WAV plus a JSON sidecar with whisper's answer. This script
// stitches the commits back onto the session clock, transcribes the
// whole recording once as a reference, and reports per commit whether
// speech went missing before the commit (a gap on the clock), inside
// whisper (speech-no-text / partial), or was never there (silence).
//
//   node scripts/asr-diagnose.mjs <dumpDir> [--session <tag>]
//        [--model <ggml.bin>] [--whisper-cli <cmd...>]
//        [--reference <source.wav>] [--out <dir>]
//
// --reference replaces the stitched audio with a recording made at the
// source (Presence writes one when localStorage.transcriptionDebugRecord
// is "true"); its span versus the committed audio then shows loss before
// Moss. The reference transcriber defaults to whisper-cli from nix, or
// $MOSS_WHISPER_CLI when set.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildReport,
  encodeWav,
  parseDumpName,
  readWav,
  renderReport,
  stitchCommits,
} from './asr-diagnose-lib.mjs';

function parseArgs(argv) {
  const args = {
    dumpDir: undefined,
    session: undefined,
    model: undefined,
    cli: undefined,
    reference: undefined,
    out: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--session') args.session = argv[++i];
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--whisper-cli') args.cli = argv[++i];
    else if (a === '--reference') args.reference = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (!args.dumpDir) args.dumpDir = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!args.dumpDir) throw new Error('usage: asr-diagnose.mjs <dumpDir> [options]');
  return args;
}

function loadCommits(dumpDir, session) {
  const byTag = new Map();
  for (const name of readdirSync(dumpDir)) {
    const parsed = parseDumpName(name);
    if (!parsed) continue;
    const wav = readWav(readFileSync(path.join(dumpDir, name)));
    const sidecarPath = path.join(dumpDir, name.replace(/\.wav$/, '.json'));
    const sidecar = existsSync(sidecarPath) ? JSON.parse(readFileSync(sidecarPath, 'utf8')) : {};
    const segments = sidecar.segments ?? [];
    const commit = {
      ...parsed,
      sampleRate: wav.sampleRate,
      channels: wav.channels,
      pcm: wav.pcm,
      text: sidecar.text ?? segments.map((s) => s.text).join(' '),
      segments,
      error: sidecar.error,
    };
    if (!byTag.has(parsed.tag)) byTag.set(parsed.tag, []);
    byTag.get(parsed.tag).push(commit);
  }
  if (byTag.size === 0) throw new Error(`no asr-*.wav dumps in ${dumpDir}`);
  const tag = session ?? [...byTag.keys()].sort().at(-1);
  const commits = byTag.get(tag);
  if (!commits) throw new Error(`no session ${tag}; have ${[...byTag.keys()].join(', ')}`);
  return { tag, commits: commits.sort((a, b) => a.index - b.index), sessions: [...byTag.keys()] };
}

function defaultModel() {
  const candidates = [
    process.env.MOSS_ASR_MODEL,
    path.join('resources', 'models', 'ggml-base.en.bin'),
    path.join('spikes', 'asr-m0', 'models', 'ggml-base.en.bin'),
  ].filter(Boolean);
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`no model found; pass --model (tried ${candidates.join(', ')})`);
  return found;
}

function transcribeReference(wavPath, model, cli, outPrefix) {
  const command = cli
    ? cli.split(' ')
    : process.env.MOSS_WHISPER_CLI
      ? process.env.MOSS_WHISPER_CLI.split(' ')
      : ['nix', 'shell', 'nixpkgs#whisper-cpp', '-c', 'whisper-cli'];
  const [cmd, ...lead] = command;
  execFileSync(cmd, [...lead, '-m', model, '-f', wavPath, '-oj', '-of', outPrefix, '-np'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const json = JSON.parse(readFileSync(`${outPrefix}.json`, 'utf8'));
  return (json.transcription ?? []).map((s) => ({
    fromMs: s.offsets.from,
    toMs: s.offsets.to,
    text: s.text,
  }));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { tag, commits, sessions } = loadCommits(args.dumpDir, args.session);
  const out = args.out ?? args.dumpDir;
  mkdirSync(out, { recursive: true });

  const stitched = stitchCommits(commits);
  const stitchedPath = path.join(out, `session-${tag}.wav`);
  writeFileSync(stitchedPath, encodeWav(stitched.pcm, stitched.sampleRate, stitched.channels));

  const referencePath = args.reference ?? stitchedPath;
  const referenceSpanMs = args.reference
    ? (() => {
        const r = readWav(readFileSync(args.reference));
        return Math.round((r.pcm.length / r.channels / r.sampleRate) * 1000);
      })()
    : stitched.spanMs;

  const model = args.model ?? defaultModel();
  const reference = transcribeReference(
    referencePath,
    model,
    args.cli,
    path.join(out, `reference-${tag}`),
  );

  const report = buildReport(commits, reference);
  const md = renderReport(report, {
    session: tag,
    'sessions in dir': sessions.join(', '),
    'reference audio': referencePath,
    'reference span': `${(referenceSpanMs / 1000).toFixed(1)}s`,
    'session span (first commit start to last commit end)': `${(stitched.spanMs / 1000).toFixed(1)}s`,
    'dropped as pre-speech silence': `${(stitched.gapsMs / 1000).toFixed(1)}s`,
    'reference transcript': reference.map((r) => r.text.trim()).join(' '),
  });
  const reportPath = path.join(out, `report-${tag}.md`);
  writeFileSync(reportPath, md);
  process.stdout.write(md);
  process.stdout.write(`\nwrote ${reportPath}\n`);
}

main();

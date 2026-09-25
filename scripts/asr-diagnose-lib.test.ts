import { describe, expect, it } from 'vitest';

import {
  alignReference,
  buildReport,
  encodeWav,
  parseDumpName,
  readWav,
  rmsOf,
  stitchCommits,
  type Commit,
  type ReferenceSegment,
} from './asr-diagnose-lib.mjs';

function tone(samples: number, amplitude = 0.3): Int16Array {
  const out = new Int16Array(samples);
  const v = Math.round(amplitude * 32767);
  for (let i = 0; i < samples; i++) out[i] = i % 2 === 0 ? v : -v;
  return out;
}

function commit(overrides: Partial<Commit>): Commit {
  return {
    tag: 't',
    index: 0,
    baseMs: 0,
    durationMs: 1000,
    sampleRate: 16_000,
    channels: 1,
    pcm: new Int16Array(16_000),
    text: '',
    segments: [],
    ...overrides,
  };
}

describe('parseDumpName', () => {
  it('extracts tag, index, base and duration from a dump file name', () => {
    expect(parseDumpName('asr-m1abc-x9q2-007-at38000ms-2300ms.wav')).toEqual({
      tag: 'm1abc-x9q2',
      index: 7,
      baseMs: 38_000,
      durationMs: 2300,
    });
  });

  it('returns null for unrelated files', () => {
    expect(parseDumpName('session-x.wav')).toBeNull();
    expect(parseDumpName('asr-m1-007-at38000ms-2300ms.json')).toBeNull();
  });
});

describe('wav round trip', () => {
  it('encodes and decodes PCM16 mono', () => {
    const pcm = tone(320);
    const buf = encodeWav(pcm, 16_000, 1);
    const back = readWav(buf);
    expect(back.sampleRate).toBe(16_000);
    expect(back.channels).toBe(1);
    expect(Array.from(back.pcm)).toEqual(Array.from(pcm));
  });
});

describe('stitchCommits', () => {
  it('lays commits on the session clock and fills gaps with silence', () => {
    const a = commit({ index: 0, baseMs: 0, durationMs: 1000, pcm: tone(16_000) });
    const b = commit({ index: 1, baseMs: 3000, durationMs: 500, pcm: tone(8_000) });
    const s = stitchCommits([b, a]);
    expect(s.sampleRate).toBe(16_000);
    expect(s.spanMs).toBe(3500);
    expect(s.pcm.length).toBe(16_000 * 3.5);
    expect(s.pcm[0]).not.toBe(0);
    expect(s.pcm[16_000 * 2]).toBe(0);
    expect(s.pcm[16_000 * 3]).not.toBe(0);
    expect(s.gapsMs).toBe(2000);
  });
});

describe('alignReference', () => {
  it('collects reference segments overlapping each commit window', () => {
    const ref: ReferenceSegment[] = [
      { fromMs: 0, toMs: 900, text: 'one' },
      { fromMs: 950, toMs: 2000, text: 'two' },
      { fromMs: 3100, toMs: 3400, text: 'three' },
    ];
    const commits = [
      commit({ index: 0, baseMs: 0, durationMs: 1000 }),
      commit({ index: 1, baseMs: 3000, durationMs: 500 }),
    ];
    const aligned = alignReference(commits, ref);
    expect(aligned[0].referenceText).toBe('one two');
    expect(aligned[1].referenceText).toBe('three');
  });
});

describe('buildReport', () => {
  it('flags commits whose audio carries speech but whose text is empty', () => {
    const loud = commit({ index: 0, baseMs: 0, durationMs: 1000, pcm: tone(16_000), text: '' });
    const quiet = commit({
      index: 1,
      baseMs: 1000,
      durationMs: 1000,
      pcm: new Int16Array(16_000),
      text: '',
    });
    const fine = commit({
      index: 2,
      baseMs: 2000,
      durationMs: 1000,
      pcm: tone(16_000),
      text: 'hello',
    });
    const report = buildReport(
      [loud, quiet, fine],
      [
        { fromMs: 0, toMs: 900, text: 'lost words' },
        { fromMs: 2000, toMs: 2900, text: 'hello' },
      ],
    );
    expect(report.rows.map((r) => r.verdict)).toEqual(['speech-no-text', 'silence', 'ok']);
    expect(report.summary.committedMs).toBe(3000);
    expect(report.summary.speechNoTextMs).toBe(1000);
    expect(report.rows[0].referenceText).toBe('lost words');
  });

  it('flags commits whose reference words mostly vanished from the commit text', () => {
    const c = commit({
      index: 0,
      baseMs: 0,
      durationMs: 4000,
      pcm: tone(64_000),
      text: 'the quick',
    });
    const report = buildReport(
      [c],
      [{ fromMs: 0, toMs: 3900, text: 'the quick brown fox jumps over the lazy dog' }],
    );
    expect(report.rows[0].verdict).toBe('partial');
    expect(report.rows[0].wordRecall).toBeLessThan(0.5);
  });
});

describe('rmsOf', () => {
  it('is zero for silence and near the amplitude for a square tone', () => {
    expect(rmsOf(new Int16Array(100))).toBe(0);
    expect(rmsOf(tone(100, 0.3))).toBeCloseTo(0.3, 2);
  });
});

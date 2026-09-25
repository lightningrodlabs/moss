import { describe, it, expect } from 'vitest';
import { FRAME_SAMPLES, MAX_BACKLOG_CHUNKS, mixToInt16, takeFrameInputs } from './audioMixer';

const filled = (value: number, length = FRAME_SAMPLES) => new Float32Array(length).fill(value);

describe('mixToInt16', () => {
  it('no inputs → a silent frame of FRAME_SAMPLES', () => {
    const out = mixToInt16([]);
    expect(out).toBeInstanceOf(Int16Array);
    expect(out.length).toBe(FRAME_SAMPLES);
    expect(out.every((s) => s === 0)).toBe(true);
  });

  it('quantises one input: 0.5 → 16384 (round half up), -0.5 → -16384', () => {
    const input = filled(0.5);
    input[1] = -0.5;
    const out = mixToInt16([input]);
    expect(out[0]).toBe(16384);
    expect(out[1]).toBe(-16384);
  });

  it('sums two inputs', () => {
    const out = mixToInt16([filled(0.25), filled(0.25)]);
    expect(out[0]).toBe(16384);
  });

  it('clamps the sum to full scale in both directions', () => {
    const pos = mixToInt16([filled(0.8), filled(0.8)]);
    const neg = mixToInt16([filled(-0.8), filled(-0.8)]);
    expect(pos[0]).toBe(32767);
    expect(neg[0]).toBe(-32768);
  });

  it('a short input is zero-padded, a long input is truncated (Review Focus 1)', () => {
    const short = mixToInt16([filled(0.5, 10)]);
    expect(short.length).toBe(FRAME_SAMPLES);
    expect(short[9]).toBe(16384);
    expect(short[10]).toBe(0);
    const long = mixToInt16([filled(0.5, FRAME_SAMPLES + 100)]);
    expect(long.length).toBe(FRAME_SAMPLES);
  });

  it('NaN samples contribute silence rather than poisoning the frame', () => {
    const input = filled(0.5);
    input[0] = NaN;
    expect(mixToInt16([input])[0]).toBe(0);
  });
});

describe('takeFrameInputs', () => {
  it('pops one chunk from each non-empty queue, leaving empty queues out', () => {
    const a = [filled(1), filled(2)];
    const b: Float32Array[] = [];
    const c = [filled(3)];
    const { inputs, dropped } = takeFrameInputs([a, b, c]);
    expect(inputs.map((x) => x[0])).toEqual([1, 3]);
    expect(dropped).toBe(0);
    expect(a.length).toBe(1);
    expect(c.length).toBe(0);
  });

  it('drops the oldest chunks beyond the backlog cap and counts them', () => {
    const q = Array.from({ length: MAX_BACKLOG_CHUNKS + 3 }, (_, i) => filled(i));
    const { inputs, dropped } = takeFrameInputs([q]);
    expect(dropped).toBe(3);
    expect(inputs[0][0]).toBe(3);
    expect(q.length).toBe(MAX_BACKLOG_CHUNKS - 1);
  });

  it('all queues empty → no inputs, no drops', () => {
    expect(takeFrameInputs([[], []])).toEqual({ inputs: [], dropped: 0 });
  });
});

import { describe, it, expect } from 'vitest';
import { PcmRing, RING_CAPACITY_SAMPLES } from './pcm-ring.js';

const int16 = (values: number[]) => Int16Array.from(values);
const floats = (n: number) => new Float32Array(n);

describe('PcmRing', () => {
  it('RING_CAPACITY_SAMPLES is 200 ms at 48 kHz', () => {
    expect(RING_CAPACITY_SAMPLES).toBe(9600);
  });

  it('reads back what was written, converted to float by 1/32768', () => {
    const ring = new PcmRing(8);
    ring.writeInt16(int16([16384, -32768, 0]));
    const out = floats(3);
    ring.readInto(out);
    expect(Array.from(out)).toEqual([0.5, -1, 0]);
    expect(ring.available()).toBe(0);
  });

  it('zero-fills on underrun and counts the missing samples', () => {
    const ring = new PcmRing(8);
    ring.writeInt16(int16([32767]));
    const out = floats(4);
    out.fill(9);
    ring.readInto(out);
    expect(out[0]).toBeCloseTo(32767 / 32768, 6);
    expect(Array.from(out.subarray(1))).toEqual([0, 0, 0]);
    expect(ring.stats().underrunSamples).toBe(3);
  });

  it('drops the oldest samples on overflow and counts them', () => {
    const ring = new PcmRing(4);
    ring.writeInt16(int16([1, 2, 3]));
    ring.writeInt16(int16([4, 5, 6]));
    expect(ring.available()).toBe(4);
    expect(ring.stats().overflowDropped).toBe(2);
    const out = floats(4);
    ring.readInto(out);
    expect(Array.from(out).map((v) => Math.round(v * 32768))).toEqual([3, 4, 5, 6]);
  });

  it('wraps around the end of the buffer', () => {
    const ring = new PcmRing(5);
    ring.writeInt16(int16([1, 2, 3, 4]));
    ring.readInto(floats(3));
    ring.writeInt16(int16([5, 6, 7]));
    const out = floats(4);
    ring.readInto(out);
    expect(Array.from(out).map((v) => Math.round(v * 32768))).toEqual([4, 5, 6, 7]);
  });

  it('a frame longer than the capacity keeps only its newest samples', () => {
    const ring = new PcmRing(3);
    ring.writeInt16(int16([1, 2, 3, 4, 5]));
    expect(ring.available()).toBe(3);
    expect(ring.stats().overflowDropped).toBe(2);
    const out = floats(3);
    ring.readInto(out);
    expect(Array.from(out).map((v) => Math.round(v * 32768))).toEqual([3, 4, 5]);
  });

  it('is length-agnostic: 960-sample frames and 128-sample reads interleave (Review Focus 3)', () => {
    const ring = new PcmRing(RING_CAPACITY_SAMPLES);
    ring.writeInt16(new Int16Array(960).fill(100));
    let read = 0;
    const out = floats(128);
    while (ring.available() > 0) {
      ring.readInto(out);
      read += 128;
    }
    expect(read).toBe(1024);
    expect(ring.stats()).toEqual({ written: 960, overflowDropped: 0, underrunSamples: 64 });
  });

  it('stats() counts written samples', () => {
    const ring = new PcmRing(8);
    ring.writeInt16(int16([1, 2]));
    ring.writeInt16(int16([3]));
    expect(ring.stats().written).toBe(3);
  });
});

describe('PcmRing is embeddable in a worklet module string', () => {
  // The worklet processor runs on the audio thread from a Blob module that
  // cannot import anything, so the class source is spliced in verbatim.
  const source = PcmRing.toString();

  it('compiles to a self-contained class expression', () => {
    expect(source.startsWith('class ')).toBe(true);
    expect(source).not.toMatch(/\bimport\b|\brequire\(|\bexport\b|tslib|__(?:extends|assign|spreadArray|classPrivate)/);
  });

  it('re-evaluates from its own source with identical behaviour', () => {
    const Rebuilt = new Function(`return (${source});`)() as typeof PcmRing;
    const ring = new Rebuilt(4);
    ring.writeInt16(int16([1, 2, 3, 4, 5]));
    const out = floats(4);
    ring.readInto(out);
    expect(Array.from(out).map((v) => Math.round(v * 32768))).toEqual([2, 3, 4, 5]);
    expect(ring.stats().overflowDropped).toBe(1);
  });
});

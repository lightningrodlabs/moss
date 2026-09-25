import { describe, expect, it } from 'vitest';

import { floatToPcm16Bytes } from './pcm.js';

/** Read the bytes back as little-endian 16-bit samples. */
function samples(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: number[] = [];
  for (let i = 0; i < bytes.byteLength; i += 2) out.push(view.getInt16(i, true));
  return out;
}

describe('floatToPcm16Bytes', () => {
  it('produces two little-endian bytes per sample', () => {
    const bytes = floatToPcm16Bytes(new Float32Array([0, 0.5, -0.5]));
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBe(6);
    expect(samples(bytes)).toEqual([0, 16383, -16384]);
  });

  it('maps full scale to the int16 limits', () => {
    expect(samples(floatToPcm16Bytes(new Float32Array([1, -1])))).toEqual([32767, -32768]);
  });

  it('clamps samples outside [-1, 1]', () => {
    expect(samples(floatToPcm16Bytes(new Float32Array([2.5, -3])))).toEqual([32767, -32768]);
  });

  it('returns an empty buffer for no samples', () => {
    expect(floatToPcm16Bytes(new Float32Array(0)).byteLength).toBe(0);
  });
});

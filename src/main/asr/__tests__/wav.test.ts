import { describe, expect, it } from 'vitest';

import { pcm16ToWav } from '../wav';

describe('pcm16ToWav', () => {
  it('produces a valid 16-bit PCM RIFF/WAVE header at the requested rate', () => {
    const samples = new Int16Array([0, 1, -1, 32767, -32768]);
    const wav = pcm16ToWav(samples, { sampleRate: 16_000, channels: 1 });

    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    expect(wav.readUInt16LE(20)).toBe(1); // PCM format
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt16LE(34)).toBe(16); // bits/sample
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(samples.byteLength);

    // Round-trip: header bytes + payload bytes.
    expect(wav.length).toBe(44 + samples.byteLength);
    const payload = new Int16Array(wav.buffer, wav.byteOffset + 44, samples.length);
    expect(Array.from(payload)).toEqual(Array.from(samples));
  });

  it('reflects stereo channel count and rate in header byte rate / block align', () => {
    const samples = new Int16Array(8); // 4 stereo frames
    const wav = pcm16ToWav(samples, { sampleRate: 48_000, channels: 2 });
    expect(wav.readUInt16LE(22)).toBe(2);
    expect(wav.readUInt32LE(24)).toBe(48_000);
    expect(wav.readUInt32LE(28)).toBe(48_000 * 2 * 2); // byteRate
    expect(wav.readUInt16LE(32)).toBe(2 * 2); // blockAlign
  });
});

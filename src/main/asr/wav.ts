// PCM16 → WAV byte buffer.
//
// whisper-server's /inference endpoint accepts WAV uploads. AsrSession
// receives raw PCM16 (Int16Array) from callers and wraps it with a
// minimal RIFF/WAVE header before POSTing. This is the only place that
// shape conversion lives; everything internal is PCM16 mono @ 16 kHz.

const PCM16_BIT_DEPTH = 16;

export interface PcmShape {
  /** Frames per second. Moss expects 16000 internally. */
  sampleRate: number;
  /** Mono = 1, stereo = 2. */
  channels: 1 | 2;
}

/**
 * Wrap PCM16 samples as a self-contained 16-bit PCM WAV buffer.
 * Caller owns the Int16Array; this function only reads it.
 */
export function pcm16ToWav(pcm: Int16Array, shape: PcmShape): Buffer {
  const { sampleRate, channels } = shape;
  const bytesPerSample = PCM16_BIT_DEPTH / 8;
  const byteRate = sampleRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const dataLength = pcm.byteLength;
  const headerLength = 44;

  const buf = Buffer.alloc(headerLength + dataLength);
  // RIFF chunk descriptor
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataLength, 4);
  buf.write('WAVE', 8, 'ascii');
  // fmt sub-chunk
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);            // PCM fmt chunk size
  buf.writeUInt16LE(1, 20);             // PCM format code
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(PCM16_BIT_DEPTH, 34);
  // data sub-chunk
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataLength, 40);

  // Copy PCM payload. Buffer.from on the underlying ArrayBuffer is
  // zero-copy on the slice itself.
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buf, headerLength);
  return buf;
}

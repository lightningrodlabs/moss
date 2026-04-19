// Minimal WAV / PCM helpers for the M0 spike.
//
// Whisper wants Float32Array mono @ 16 kHz, normalized to [-1, 1].
// Tools using the public AsrApi will push Int16Array PCM at whatever
// sample rate they have; the spike accepts the same shape on stdin.

const TARGET_SR = 16_000;

/**
 * Parse a minimal RIFF/WAVE PCM16 header. Returns sample rate, channels,
 * and the byte offset where audio data begins. Throws on anything we
 * don't understand.
 */
export function parseWavHeader(buf) {
  if (buf.length < 44) throw new Error('buffer too short for WAV header');
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a RIFF file');
  if (buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAVE file');

  // Walk chunks until we hit fmt + data.
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      const format = buf.readUInt16LE(body);
      if (format !== 1) throw new Error(`unsupported WAV format code ${format} (need PCM=1)`);
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bitsPerSample = buf.readUInt16LE(body + 14);
      if (bitsPerSample !== 16) throw new Error(`expected 16-bit PCM, got ${bitsPerSample}-bit`);
    } else if (id === 'data') {
      dataOffset = body;
      dataLength = size;
      break;
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }

  if (dataOffset < 0) throw new Error('no data chunk found');
  if (!sampleRate || !channels) throw new Error('no fmt chunk found');

  return { sampleRate, channels, bitsPerSample, dataOffset, dataLength };
}

/**
 * Convert PCM16 (Int16Array view) → Float32Array in [-1, 1].
 * If `channels === 2`, downmixes to mono by averaging.
 * If `sampleRate !== TARGET_SR`, linearly resamples (cheap; whisper is
 * forgiving). For real Moss code we'd use a proper polyphase resampler.
 */
export function pcm16ToFloat32Mono(int16, sampleRate, channels) {
  // Step 1: downmix to mono Int16
  let mono;
  if (channels === 1) {
    mono = int16;
  } else if (channels === 2) {
    const frames = int16.length / 2;
    mono = new Int16Array(frames);
    for (let i = 0; i < frames; i++) {
      mono[i] = (int16[2 * i] + int16[2 * i + 1]) >> 1;
    }
  } else {
    throw new Error(`unsupported channel count: ${channels}`);
  }

  // Step 2: convert to Float32 in [-1, 1]
  const f32 = new Float32Array(mono.length);
  for (let i = 0; i < mono.length; i++) {
    f32[i] = mono[i] / 32768;
  }

  // Step 3: resample to 16 kHz if needed (linear interp, spike-grade)
  if (sampleRate === TARGET_SR) return f32;
  const ratio = sampleRate / TARGET_SR;
  const outLen = Math.floor(f32.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, f32.length - 1);
    const t = src - i0;
    out[i] = f32[i0] * (1 - t) + f32[i1] * t;
  }
  return out;
}

/**
 * Read an entire file or stdin as a Buffer. Used by harness-batch.
 */
export async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * If `buf` looks like a WAV, parse it and return Float32 mono @ 16 kHz.
 * Otherwise treat it as raw PCM16 mono @ 16 kHz (the contract for stdin).
 */
export function bufferToFloat32(buf, opts = {}) {
  const looksLikeWav = buf.length >= 12
    && buf.toString('ascii', 0, 4) === 'RIFF'
    && buf.toString('ascii', 8, 12) === 'WAVE';
  if (looksLikeWav) {
    const { sampleRate, channels, dataOffset, dataLength } = parseWavHeader(buf);
    const audio = new Int16Array(buf.buffer, buf.byteOffset + dataOffset, dataLength / 2);
    return pcm16ToFloat32Mono(audio, sampleRate, channels);
  }
  // raw PCM16 mono assumed
  const sampleRate = opts.sampleRate ?? TARGET_SR;
  const channels = opts.channels ?? 1;
  if (buf.length % 2 !== 0) throw new Error('raw PCM input has odd byte length');
  const audio = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  return pcm16ToFloat32Mono(audio, sampleRate, channels);
}

export const SAMPLE_RATE = TARGET_SR;

// Audio sample conversion for Moss-side ASR sessions. The main process
// expects raw PCM16 little-endian bytes (see asrPushAudio), while the
// microphone yields normalized float samples.

/** Convert normalized float samples to PCM16 little-endian bytes, clamping to [-1, 1]. */
export function floatToPcm16Bytes(f32: Float32Array): Uint8Array {
  const bytes = new Uint8Array(f32.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    view.setInt16(i * 2, s < 0 ? s * 32768 : s * 32767, true);
  }
  return bytes;
}

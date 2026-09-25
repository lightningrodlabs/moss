// Microphone capture for Moss-side dictation. Reads raw frames with
// MediaStreamTrackProcessor at the device's native rate; the ASR session
// is opened with that rate, and main resamples for the model.

import type { MicCapture } from './dictation.js';

type TrackProcessorCtor = new (init: { track: MediaStreamTrack }) => {
  readable: ReadableStream<AudioData>;
};

export async function openMicCapture(): Promise<MicCapture> {
  const Processor = (window as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor })
    .MediaStreamTrackProcessor;
  if (!Processor) throw new Error('MediaStreamTrackProcessor is not available');

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const track = stream.getAudioTracks()[0];
  const reader = new Processor({ track }).readable.getReader();
  let stopped = false;

  return {
    sampleRate: track.getSettings().sampleRate ?? 48_000,
    async read() {
      if (stopped) return null;
      const { done, value } = await reader.read();
      if (done || !value) return null;
      try {
        return copyFirstChannel(value);
      } finally {
        value.close();
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      // Cancelling resolves any pending read with done; stopping the
      // tracks turns off the system microphone indicator.
      reader.cancel().catch(() => undefined);
      for (const t of stream.getTracks()) t.stop();
    },
  };
}

function copyFirstChannel(frame: AudioData): Float32Array {
  const samples = new Float32Array(frame.numberOfFrames);
  try {
    frame.copyTo(samples, { planeIndex: 0, format: 'f32-planar' });
  } catch {
    // Some builds reject an explicit format for data already in f32.
    frame.copyTo(samples, { planeIndex: 0 });
  }
  return samples;
}

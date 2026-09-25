/**
 * Fixed-capacity mono PCM ring shared by the host-frame path and the audio
 * thread. The audio-source worklet processor is registered from an inline
 * module (a Blob URL) that cannot import anything, so this class is spliced
 * into that module's source with `PcmRing.toString()`. It therefore uses no
 * imports, no module-level helpers and no class fields — only what the ES2018
 * build leaves inside the class body. `pcm-ring.test.ts` pins that.
 */

/** 200 ms of mono audio at the fixed 48 kHz frame rate. */
export const RING_CAPACITY_SAMPLES = 9600;

export interface PcmRingStats {
  /** Samples accepted from the host (after overflow trimming). */
  written: number;
  /** Samples discarded because the reader fell behind by more than the capacity. */
  overflowDropped: number;
  /** Samples the reader asked for that were not there (zero-filled). */
  underrunSamples: number;
}

export class PcmRing {
  private buffer: Float32Array;
  private capacity: number;
  private head: number;
  private length: number;
  private written: number;
  private overflowDropped: number;
  private underrunSamples: number;

  constructor(capacity: number) {
    this.buffer = new Float32Array(capacity);
    this.capacity = capacity;
    this.head = 0;
    this.length = 0;
    this.written = 0;
    this.overflowDropped = 0;
    this.underrunSamples = 0;
  }

  available(): number {
    return this.length;
  }

  /** Appends a frame of 16-bit samples, discarding the oldest audio when full. */
  writeInt16(frame: Int16Array): void {
    let start = 0;
    if (frame.length > this.capacity) {
      this.overflowDropped += frame.length - this.capacity;
      start = frame.length - this.capacity;
    }
    const incoming = frame.length - start;
    const overflow = this.length + incoming - this.capacity;
    if (overflow > 0) {
      this.head = (this.head + overflow) % this.capacity;
      this.length -= overflow;
      this.overflowDropped += overflow;
    }
    let tail = (this.head + this.length) % this.capacity;
    for (let i = start; i < frame.length; i++) {
      this.buffer[tail] = frame[i] / 32768;
      tail = (tail + 1) % this.capacity;
    }
    this.length += incoming;
    this.written += incoming;
  }

  /** Fills `out` with the oldest samples, zero-filling whatever is missing. */
  readInto(out: Float32Array): void {
    const n = Math.min(out.length, this.length);
    for (let i = 0; i < n; i++) {
      out[i] = this.buffer[this.head];
      this.head = (this.head + 1) % this.capacity;
    }
    this.length -= n;
    for (let i = n; i < out.length; i++) out[i] = 0;
    this.underrunSamples += out.length - n;
  }

  stats(): PcmRingStats {
    return {
      written: this.written,
      overflowDropped: this.overflowDropped,
      underrunSamples: this.underrunSamples,
    };
  }
}

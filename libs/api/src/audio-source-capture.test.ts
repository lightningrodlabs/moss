import { describe, it, expect, vi } from 'vitest';
import {
  AUDIO_SOURCE_SAMPLE_RATE,
  WORKLET_PROCESSOR_NAME,
  WORKLET_SOURCE,
  selectContext,
} from './audio-source-capture.js';
import { PcmRing, RING_CAPACITY_SAMPLES } from './pcm-ring.js';

const ctx = (sampleRate: number) => ({ sampleRate }) as unknown as AudioContext;

describe('selectContext (Review Focus 5)', () => {
  it('uses the preferred context when it runs at 48 kHz', () => {
    const create = vi.fn();
    const preferred = ctx(48000);
    expect(selectContext(preferred, create)).toEqual({ context: preferred, owned: false });
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a private 48 kHz context when the preferred one runs at another rate', () => {
    const created = ctx(48000);
    const create = vi.fn(() => created);
    expect(selectContext(ctx(44100), create)).toEqual({ context: created, owned: true });
    expect(create).toHaveBeenCalledWith(AUDIO_SOURCE_SAMPLE_RATE);
  });

  it('creates a private context when none is preferred', () => {
    const created = ctx(48000);
    expect(selectContext(undefined, () => created)).toEqual({ context: created, owned: true });
  });
});

describe('WORKLET_SOURCE', () => {
  it('embeds PcmRing verbatim and registers the processor under the shared name', () => {
    expect(WORKLET_SOURCE).toContain(PcmRing.toString());
    expect(WORKLET_SOURCE).toContain(`registerProcessor(${JSON.stringify(WORKLET_PROCESSOR_NAME)}`);
    expect(WORKLET_SOURCE).toContain(`new ${PcmRing.name}(${RING_CAPACITY_SAMPLES})`);
  });

  it('is self-contained module code (no imports, no helpers)', () => {
    expect(WORKLET_SOURCE).not.toMatch(/\bimport\b|\brequire\(|\bexport\b|tslib/);
  });

  it('defines a processor that pulls from the ring and stops when told to close', () => {
    // Evaluate the module with a stub AudioWorkletProcessor/registerProcessor to
    // exercise the processor class without an audio thread.
    const registered: Record<string, new () => { process: (i: unknown, o: Float32Array[][]) => boolean; port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: (m: unknown) => void } }> = {};
    class AudioWorkletProcessor {
      port = { onmessage: null as ((e: { data: unknown }) => void) | null, postMessage: vi.fn() };
    }
    const registerProcessor = (name: string, cls: (typeof registered)[string]) => {
      registered[name] = cls;
    };
    new Function('AudioWorkletProcessor', 'registerProcessor', WORKLET_SOURCE)(AudioWorkletProcessor, registerProcessor);
    const Processor = registered[WORKLET_PROCESSOR_NAME];
    expect(Processor).toBeDefined();
    const p = new Processor();
    p.port.onmessage!({ data: new Int16Array(256).fill(16384) });
    const out = [[new Float32Array(128)]];
    expect(p.process([], out)).toBe(true);
    expect(out[0][0][0]).toBe(0.5);
    p.port.onmessage!({ data: { type: 'stats' } });
    expect(p.port.postMessage).toHaveBeenCalledWith({
      type: 'stats',
      written: 256,
      overflowDropped: 0,
      underrunSamples: 0,
    });
    p.port.onmessage!({ data: { type: 'close' } });
    expect(p.process([], out)).toBe(false);
  });
});

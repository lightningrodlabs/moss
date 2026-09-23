import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AUDIO_SOURCE_SAMPLE_RATE,
  WORKLET_PROCESSOR_NAME,
  WORKLET_SOURCE,
  selectContext,
  createAudioSourceCaptureWith,
  ensureWorkletModule,
  type CaptureEnv,
  type AudioSourceDelivery,
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

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakePort() {
  return {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    start: vi.fn(),
    postMessage: vi.fn(),
    close: vi.fn(),
  };
}

function fakeTrack() {
  const track = { readyState: 'live' as 'live' | 'ended', stop: vi.fn() };
  track.stop.mockImplementation(() => {
    track.readyState = 'ended';
  });
  return track;
}

function fakeContext(overrides: { state?: string } = {}) {
  const track = fakeTrack();
  const context = {
    sampleRate: AUDIO_SOURCE_SAMPLE_RATE,
    state: overrides.state ?? 'running',
    createMediaStreamDestination: () => ({ stream: { getAudioTracks: () => [track] } }),
    close: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
  };
  return { context, track };
}

function fakeNode() {
  return {
    port: { postMessage: vi.fn(), onmessage: null as ((e: { data: unknown }) => void) | null },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function fakeEnv(overrides: Partial<CaptureEnv> = {}): CaptureEnv {
  return {
    createContext: vi.fn(() => {
      throw new Error('unexpected createContext call — supply one via overrides');
    }),
    loadWorkletModule: vi.fn(async () => undefined),
    createNode: vi.fn(() => fakeNode() as unknown as AudioWorkletNode),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    ...overrides,
  };
}

describe('createAudioSourceCaptureWith', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes queued frames in order once the module loads', async () => {
    const port = fakePort();
    const delivery: AudioSourceDelivery = {
      label: 'System audio',
      canExcludeSelf: true,
      port: port as unknown as MessagePort,
    };
    const { context } = fakeContext();
    const node = fakeNode();
    const load = deferred();
    const env = fakeEnv({
      createContext: vi.fn(() => context as unknown as AudioContext),
      loadWorkletModule: vi.fn(() => load.promise),
      createNode: vi.fn(() => node as unknown as AudioWorkletNode),
    });

    const capturePromise = createAudioSourceCaptureWith(delivery, {}, env);

    // Frames arrive before the module resolves; the session queues them.
    const frameA = new Int16Array([1]);
    const frameB = new Int16Array([2]);
    port.onmessage!({ data: frameA });
    port.onmessage!({ data: frameB });
    expect(node.port.postMessage).not.toHaveBeenCalled();

    load.resolve();
    const capture = await capturePromise;

    expect(port.start).toHaveBeenCalled();
    expect(node.connect).toHaveBeenCalled();
    expect(node.port.postMessage).toHaveBeenNthCalledWith(1, frameA, [frameA.buffer]);
    expect(node.port.postMessage).toHaveBeenNthCalledWith(2, frameB, [frameB.buffer]);
    expect(capture.label).toBe('System audio');
    expect(capture.canExcludeSelf).toBe(true);
  });

  it('tears down the grant and rethrows when the worklet module fails to load (Finding 1)', async () => {
    const port = fakePort();
    const { context, track } = fakeContext();
    const err = new Error('NotSupportedError');
    const env = fakeEnv({
      createContext: vi.fn(() => context as unknown as AudioContext),
      loadWorkletModule: vi.fn(async () => {
        throw err;
      }),
    });
    const delivery: AudioSourceDelivery = { label: 'x', canExcludeSelf: true, port: port as unknown as MessagePort };

    await expect(createAudioSourceCaptureWith(delivery, {}, env)).rejects.toThrow(err);

    expect(port.postMessage).toHaveBeenCalledWith({ type: 'close' });
    expect(port.close).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('resolves already-ended when the host ends the grant during module load, and still fires onended once (Finding 3)', async () => {
    const port = fakePort();
    const { context, track } = fakeContext();
    const load = deferred();
    const env = fakeEnv({
      createContext: vi.fn(() => context as unknown as AudioContext),
      loadWorkletModule: vi.fn(() => load.promise),
    });
    const delivery: AudioSourceDelivery = { label: 'x', canExcludeSelf: true, port: port as unknown as MessagePort };

    const capturePromise = createAudioSourceCaptureWith(delivery, {}, env);

    port.onmessage!({ data: { type: 'ended', reason: 'user-stopped' } });
    load.resolve();
    const capture = await capturePromise;

    expect(track.readyState).toBe('ended');
    expect(capture.endedReason).toBe('user-stopped');

    // The Tool assigns onended only after this promise resolved — exactly
    // the case the internal `session.onended` callback could not reach.
    const onended = vi.fn();
    capture.onended = onended;
    expect(onended).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);
    expect(onended).toHaveBeenCalledTimes(1);
  });

  it('resumes a suspended context once the module loads (Finding 2)', async () => {
    const port = fakePort();
    const { context } = fakeContext({ state: 'suspended' });
    const node = fakeNode();
    const env = fakeEnv({
      createContext: vi.fn(() => context as unknown as AudioContext),
      createNode: vi.fn(() => node as unknown as AudioWorkletNode),
    });
    const delivery: AudioSourceDelivery = { label: 'x', canExcludeSelf: true, port: port as unknown as MessagePort };

    await createAudioSourceCaptureWith(delivery, {}, env);

    expect(context.resume).toHaveBeenCalledTimes(1);
  });

  it('stop() closes the port, disconnects the node, and stops the track, without firing onended', async () => {
    const port = fakePort();
    const { context, track } = fakeContext();
    const node = fakeNode();
    const env = fakeEnv({
      createContext: vi.fn(() => context as unknown as AudioContext),
      createNode: vi.fn(() => node as unknown as AudioWorkletNode),
    });
    const delivery: AudioSourceDelivery = { label: 'x', canExcludeSelf: true, port: port as unknown as MessagePort };

    const capture = await createAudioSourceCaptureWith(delivery, {}, env);
    const onended = vi.fn();
    capture.onended = onended;

    capture.stop();

    expect(port.postMessage).toHaveBeenCalledWith({ type: 'close' });
    expect(node.disconnect).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(onended).not.toHaveBeenCalled();
  });

  it('shares one in-flight addModule call across concurrent callers, and does not memoize a rejection (Finding 1)', async () => {
    let rejectPending!: (reason: unknown) => void;
    const addModule = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPending = reject;
        }),
    );
    // Node's global Blob/URL.createObjectURL back this real function; only
    // audioWorklet.addModule needs to be a test double.
    const context = { audioWorklet: { addModule } } as unknown as AudioContext;

    const p1 = ensureWorkletModule(context);
    const p2 = ensureWorkletModule(context);
    expect(addModule).toHaveBeenCalledTimes(1);

    const err = new Error('NotSupportedError');
    rejectPending(err);
    await expect(p1).rejects.toBe(err);
    await expect(p2).rejects.toBe(err);

    addModule.mockImplementationOnce(async () => undefined);
    await expect(ensureWorkletModule(context)).resolves.toBeUndefined();
    expect(addModule).toHaveBeenCalledTimes(2);
  });
});

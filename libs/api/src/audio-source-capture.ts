import { CaptureSession, type CaptureSessionStats } from './capture-session.js';
import { PcmRing, RING_CAPACITY_SAMPLES } from './pcm-ring.js';

/**
 * A capture of audio playing on the user's machine, granted by the host after
 * the user chose the sources in the host's own picker. `track` is a live mono
 * audio track that ends when the grant ends.
 * @public
 */
export interface AudioSourceCapture {
  /** Ends when the grant ends, for whatever reason. */
  readonly track: MediaStreamTrack;
  /** Human-readable summary of the chosen sources, e.g. "System audio". */
  readonly label: string;
  /** false → the host could not exclude its own playback; tell the user echo is possible. */
  readonly canExcludeSelf: boolean;
  /** Ends the grant from the Tool's side. Does not fire `onended`. */
  stop(): void;
  /** Set by the Tool; fires once when the host or the platform ends the grant. */
  onended?: () => void;
  /** Diagnostics, refreshed roughly once per second while live. */
  readonly stats: AudioSourceCaptureStats;
  /**
   * Why the grant ended, set only when the host or the platform ended it (the
   * host's reason, or `'host-silent'` when frames stopped arriving);
   * `track.readyState` is `'ended'` when this is set. It stays `undefined`
   * after `stop()` — the Tool ended that grant itself, so there is nothing to
   * report back to it.
   */
  readonly endedReason?: string;
}

/** @public */
export interface AudioSourceCaptureStats {
  framesReceived: number;
  /** Frames dropped from the pre-ready queue while the worklet module loaded. */
  framesDroppedBeforeReady: number;
  overflowDropped: number;
  underrunSamples: number;
  unknownMessages: number;
}

/** What the host hands over on a successful `request-audio-sources`. @public */
export interface AudioSourceDelivery {
  label: string;
  canExcludeSelf: boolean;
  port: MessagePort;
}

/** @public */
export interface CaptureAudioSourcesOptions {
  /** Build the track in this context when it runs at 48 kHz; otherwise a private one is used. */
  audioContext?: AudioContext;
}

/** The host's frame format is fixed at mono 48 kHz. @public */
export const AUDIO_SOURCE_SAMPLE_RATE = 48000;

/** @public */
export const WORKLET_PROCESSOR_NAME = 'moss-audio-source';

/** How often the worklet is asked for its ring counters while live. */
const STATS_INTERVAL_MS = 1000;

/**
 * Picks the context the audio graph lives in. Host frames are 48 kHz samples,
 * so a context at any other rate would play them at the wrong pitch; a track
 * built in a private 48 kHz context is still consumable from the Tool's own
 * context. A closed context keeps its `sampleRate`, so the rate alone is not
 * enough to accept one: nothing can be built in it, and a private context is
 * used instead.
 * @public
 */
export function selectContext(
  preferred: AudioContext | undefined,
  create: (sampleRate: number) => AudioContext,
): { context: AudioContext; owned: boolean } {
  if (preferred && preferred.sampleRate === AUDIO_SOURCE_SAMPLE_RATE && preferred.state !== 'closed') {
    return { context: preferred, owned: false };
  }
  return { context: create(AUDIO_SOURCE_SAMPLE_RATE), owned: true };
}

/**
 * The worklet module, assembled from the ring's own source so there is one
 * ring implementation. It runs on the audio thread: host frames arrive on the
 * node port, each render quantum pulls from the ring, `{type:'stats'}` asks
 * for the counters and `{type:'close'}` retires the processor.
 * @public
 */
export const WORKLET_SOURCE = `
${PcmRing.toString()}
class MossAudioSourceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new ${PcmRing.name}(${RING_CAPACITY_SAMPLES});
    this.closed = false;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d instanceof Int16Array) {
        this.ring.writeInt16(d);
      } else if (d && d.type === 'stats') {
        const s = this.ring.stats();
        this.port.postMessage({ type: 'stats', written: s.written, overflowDropped: s.overflowDropped, underrunSamples: s.underrunSamples });
      } else if (d && d.type === 'close') {
        this.closed = true;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    if (out && out[0]) this.ring.readInto(out[0]);
    return !this.closed;
  }
}
registerProcessor(${JSON.stringify(WORKLET_PROCESSOR_NAME)}, MossAudioSourceProcessor);
`;

/**
 * In-flight or completed worklet-module loads, keyed by context. Two capture
 * calls that share a context share the in-flight load rather than calling
 * `addModule` twice (which throws on the second registration of the same
 * name); a failed load is removed so a later call can retry.
 */
const moduleLoads = new WeakMap<AudioContext, Promise<void>>();

/**
 * Loads the worklet module into `context`, memoizing per context so
 * concurrent callers share one `addModule` call and a failed load can be
 * retried by a later call.
 * @internal
 */
export async function ensureWorkletModule(context: AudioContext): Promise<void> {
  const existing = moduleLoads.get(context);
  if (existing) return existing;
  const load = (async () => {
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  })();
  moduleLoads.set(context, load);
  try {
    await load;
  } catch (err) {
    moduleLoads.delete(context);
    throw err;
  }
}

/**
 * The Web Audio and timer primitives `createAudioSourceCaptureWith` needs.
 * Production supplies real `AudioContext`/`AudioWorkletNode`/globals; tests
 * supply fakes so the decision logic runs without a DOM.
 * @internal
 */
export interface CaptureEnv {
  createContext(sampleRate: number): AudioContext;
  loadWorkletModule(context: AudioContext): Promise<void>;
  createNode(context: AudioContext): AudioWorkletNode;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/**
 * Turns a host-delivered grant port into a live `MediaStreamTrack`, driven by
 * an injected `env` so it is testable without a DOM. Exported for tests only;
 * `createAudioSourceCapture` is the public entry point.
 * @internal
 */
export async function createAudioSourceCaptureWith(
  delivery: AudioSourceDelivery,
  opts: CaptureAudioSourcesOptions,
  env: CaptureEnv,
): Promise<AudioSourceCapture> {
  const { context, owned } = selectContext(opts.audioContext, env.createContext);
  const stats: AudioSourceCaptureStats = {
    framesReceived: 0,
    framesDroppedBeforeReady: 0,
    overflowDropped: 0,
    underrunSamples: 0,
    unknownMessages: 0,
  };

  let node: AudioWorkletNode | undefined;
  let statsTimer: unknown;
  // Held outside the try so the failure path can tell "the session owns the
  // teardown" from "nothing owns the port yet".
  let created: CaptureSession | undefined;

  try {
    const destination = context.createMediaStreamDestination();
    const track = destination.stream.getAudioTracks()[0];

    const session = new CaptureSession({
      forwardFrame: (frame) => node?.port.postMessage(frame, [frame.buffer]),
      teardown: () => {
        // The interval is about to go: take a final reading so a Tool that
        // looks at `stats` after the grant ended sees the whole session.
        if (created) applySessionStats(stats, created.stats());
        if (statsTimer !== undefined) env.clearInterval(statsTimer);
        statsTimer = undefined;
        node?.port.postMessage({ type: 'close' });
        node?.disconnect();
        node = undefined;
        track.stop();
        if (owned) void context.close().catch(() => undefined);
      },
      postToHost: (message) => delivery.port.postMessage(message),
      closePort: () => delivery.port.close(),
      setTimeout: (fn, ms) => env.setTimeout(fn, ms),
      clearTimeout: (handle) => env.clearTimeout(handle),
    });
    created = session;

    const capture: AudioSourceCapture = {
      track,
      label: delivery.label,
      canExcludeSelf: delivery.canExcludeSelf,
      stats,
      get endedReason() {
        return session.endedReason;
      },
      stop: () => session.stop(),
    };
    session.onended = () => capture.onended?.();

    // Frames may arrive while the module loads; the session queues them.
    delivery.port.onmessage = (e) => session.handlePortMessage(e.data);
    delivery.port.start();

    try {
      await env.loadWorkletModule(context);
    } catch (err) {
      // A grant the host already ended has nothing left to fail at: the
      // capture is handed over already-ended rather than as a failure.
      if (session.state === 'ended') {
        env.setTimeout(() => capture.onended?.(), 0);
        return capture;
      }
      throw err;
    }

    if (session.state !== 'starting') {
      if (session.state === 'ended') {
        // The Tool's `await` continuation (a microtask) assigns `onended`
        // before this macrotask runs, so scheduling here — rather than
        // calling it inline — lets a callback set after resolution still
        // fire exactly once.
        env.setTimeout(() => capture.onended?.(), 0);
      }
      return capture;
    }

    node = env.createNode(context);
    node.port.onmessage = (e) => {
      const d = e.data as { type?: unknown; written?: number; overflowDropped?: number; underrunSamples?: number };
      if (d && d.type === 'stats') {
        stats.overflowDropped = d.overflowDropped ?? 0;
        stats.underrunSamples = d.underrunSamples ?? 0;
      }
    };
    node.connect(destination);
    // Chromium may start a freshly created context suspended under its
    // autoplay policy (this capture follows an async host round-trip, so it
    // is never the direct result of a user gesture); a suspended context
    // never runs `process()`, so the ring would overflow silently. Declared,
    // not unit-tested here — it needs a real AudioContext.
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    statsTimer = env.setInterval(() => {
      applySessionStats(stats, session.stats());
      node?.port.postMessage({ type: 'stats' });
    }, STATS_INTERVAL_MS);
    session.ready();
    return capture;
  } catch (err) {
    // The host is capturing from the moment it hands the port over and only
    // stops on `{type:'close'}` or a closed port. Every failure between here
    // and a live capture must therefore release the grant before it leaves,
    // or the user keeps paying for a capture nobody consumes.
    if (created) {
      // The session owns the whole release: close message, port, track,
      // node and an owned context.
      created.stop();
    } else {
      delivery.port.postMessage({ type: 'close' });
      delivery.port.close();
      if (owned) void context.close().catch(() => undefined);
    }
    throw err;
  }
}

/** Copies the session's own counters onto the capture's public stats. */
function applySessionStats(stats: AudioSourceCaptureStats, s: CaptureSessionStats): void {
  stats.framesReceived = s.framesReceived;
  stats.framesDroppedBeforeReady = s.framesDroppedBeforeReady;
  stats.unknownMessages = s.unknownMessages;
}

/**
 * Turns a host-delivered grant port into a live `MediaStreamTrack`. The
 * returned capture may already be ended: a host end-of-grant message that
 * arrives while the worklet module is still loading resolves with
 * `track.readyState === 'ended'` and `endedReason` set, and `onended` still
 * fires once, asynchronously, even though the Tool could not have assigned
 * it before this promise resolved.
 * @public
 */
export async function createAudioSourceCapture(
  delivery: AudioSourceDelivery,
  opts: CaptureAudioSourcesOptions = {},
): Promise<AudioSourceCapture> {
  return createAudioSourceCaptureWith(delivery, opts, {
    createContext: (sampleRate) => new AudioContext({ sampleRate }),
    loadWorkletModule: ensureWorkletModule,
    createNode: (context) =>
      new AudioWorkletNode(context, WORKLET_PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      }),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  });
}

import { CaptureSession } from './capture-session.js';
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
}

/** @public */
export interface AudioSourceCaptureStats {
  framesReceived: number;
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
 * context.
 * @public
 */
export function selectContext(
  preferred: AudioContext | undefined,
  create: (sampleRate: number) => AudioContext,
): { context: AudioContext; owned: boolean } {
  if (preferred && preferred.sampleRate === AUDIO_SOURCE_SAMPLE_RATE) {
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

/** One module registration per context; `addModule` twice would throw. */
const registeredContexts = new WeakSet<AudioContext>();

async function ensureWorkletModule(context: AudioContext): Promise<void> {
  if (registeredContexts.has(context)) return;
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
  try {
    await context.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  registeredContexts.add(context);
}

/**
 * Turns a host-delivered grant port into a live `MediaStreamTrack`.
 * @public
 */
export async function createAudioSourceCapture(
  delivery: AudioSourceDelivery,
  opts: CaptureAudioSourcesOptions = {},
): Promise<AudioSourceCapture> {
  const { context, owned } = selectContext(opts.audioContext, (rate) => new AudioContext({ sampleRate: rate }));
  const destination = context.createMediaStreamDestination();
  const track = destination.stream.getAudioTracks()[0];
  const stats: AudioSourceCaptureStats = { framesReceived: 0, overflowDropped: 0, underrunSamples: 0, unknownMessages: 0 };

  let node: AudioWorkletNode | undefined;
  let statsTimer: ReturnType<typeof setInterval> | undefined;

  const session = new CaptureSession({
    forwardFrame: (frame) => node?.port.postMessage(frame, [frame.buffer]),
    teardown: () => {
      if (statsTimer !== undefined) clearInterval(statsTimer);
      statsTimer = undefined;
      node?.port.postMessage({ type: 'close' });
      node?.disconnect();
      node = undefined;
      track.stop();
      if (owned) void context.close();
    },
    postToHost: (message) => delivery.port.postMessage(message),
    closePort: () => delivery.port.close(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });

  const capture: AudioSourceCapture = {
    track,
    label: delivery.label,
    canExcludeSelf: delivery.canExcludeSelf,
    stats,
    stop: () => session.stop(),
  };
  session.onended = () => capture.onended?.();

  // Frames may arrive while the module loads; the session queues them.
  delivery.port.onmessage = (e) => session.handlePortMessage(e.data);
  delivery.port.start();

  await ensureWorkletModule(context);
  if (session.state !== 'starting') return capture;

  node = new AudioWorkletNode(context, WORKLET_PROCESSOR_NAME, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  node.port.onmessage = (e) => {
    const d = e.data as { type?: unknown; written?: number; overflowDropped?: number; underrunSamples?: number };
    if (d && d.type === 'stats') {
      stats.overflowDropped = d.overflowDropped ?? 0;
      stats.underrunSamples = d.underrunSamples ?? 0;
    }
  };
  node.connect(destination);
  statsTimer = setInterval(() => {
    const s = session.stats();
    stats.framesReceived = s.framesReceived;
    stats.unknownMessages = s.unknownMessages;
    node?.port.postMessage({ type: 'stats' });
  }, STATS_INTERVAL_MS);
  session.ready();
  return capture;
}

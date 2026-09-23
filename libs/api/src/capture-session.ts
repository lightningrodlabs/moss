/**
 * The Tool-side half of an audio-source grant's port protocol, kept free of
 * Web Audio so it can be table-tested: the host streams Int16 frames and
 * finally posts `{type:'ended', reason}`; the Tool may post `{type:'close'}`.
 * Frames that arrive before the worklet module has loaded are queued, capped
 * at MAX_PREREADY_FRAMES, and flushed in order. Because the host sends silence frames continuously, a
 * gap longer than FRAME_GAP_TIMEOUT_MS means the port is dead (the host
 * renderer crashed or the port was closed without a message — a bare port
 * close is not observable as an event in the Chromium this ships on).
 */

export const FRAME_GAP_TIMEOUT_MS = 5000;

/**
 * How many pre-ready frames are held. It is the ring's own capacity (200 ms at
 * 48 kHz, `RING_CAPACITY_SAMPLES` / `FRAME_SAMPLES`): audio older than that
 * would be discarded by the ring on the flush anyway, so holding more only
 * grows memory while a slow `addModule` is pending. The oldest are dropped, so
 * what reaches the worklet is the newest audio.
 */
export const MAX_PREREADY_FRAMES = 10;

export type CaptureState = 'starting' | 'live' | 'ended' | 'stopped';

export interface CaptureSessionBindings {
  forwardFrame: (frame: Int16Array) => void;
  teardown: () => void;
  postToHost: (message: { type: 'close' }) => void;
  closePort: () => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface CaptureSessionStats {
  framesReceived: number;
  framesQueuedBeforeReady: number;
  /** Queued frames dropped to keep the pre-ready queue at MAX_PREREADY_FRAMES. */
  framesDroppedBeforeReady: number;
  unknownMessages: number;
}

export class CaptureSession {
  state: CaptureState = 'starting';
  endedReason: string | undefined;
  onended?: () => void;

  private queue: Int16Array[] = [];
  private watchdog: unknown;
  private framesReceived = 0;
  private framesQueuedBeforeReady = 0;
  private framesDroppedBeforeReady = 0;
  private unknownMessages = 0;

  constructor(private readonly b: CaptureSessionBindings) {}

  stats(): CaptureSessionStats {
    return {
      framesReceived: this.framesReceived,
      framesQueuedBeforeReady: this.framesQueuedBeforeReady,
      framesDroppedBeforeReady: this.framesDroppedBeforeReady,
      unknownMessages: this.unknownMessages,
    };
  }

  ready(): void {
    if (this.state !== 'starting') return;
    this.state = 'live';
    for (const frame of this.queue) this.b.forwardFrame(frame);
    this.queue = [];
    this.armWatchdog();
  }

  handlePortMessage(data: unknown): void {
    if (this.state === 'ended' || this.state === 'stopped') return;
    if (data instanceof Int16Array) {
      this.framesReceived += 1;
      if (this.state === 'starting') {
        this.framesQueuedBeforeReady += 1;
        this.queue.push(data);
        while (this.queue.length > MAX_PREREADY_FRAMES) {
          this.queue.shift();
          this.framesDroppedBeforeReady += 1;
        }
        return;
      }
      this.b.forwardFrame(data);
      this.armWatchdog();
      return;
    }
    const control = data as { type?: unknown; reason?: unknown } | null;
    if (control && typeof control === 'object' && control.type === 'ended') {
      this.finish('ended', typeof control.reason === 'string' ? control.reason : 'ended');
      return;
    }
    this.unknownMessages += 1;
  }

  stop(): void {
    if (this.state === 'ended' || this.state === 'stopped') return;
    this.b.postToHost({ type: 'close' });
    this.finish('stopped', undefined);
  }

  private armWatchdog(): void {
    this.b.clearTimeout(this.watchdog);
    this.watchdog = this.b.setTimeout(() => this.finish('ended', 'host-silent'), FRAME_GAP_TIMEOUT_MS);
  }

  private finish(state: 'ended' | 'stopped', reason: string | undefined): void {
    this.b.clearTimeout(this.watchdog);
    this.watchdog = undefined;
    this.queue = [];
    this.state = state;
    this.endedReason = reason;
    this.b.closePort();
    this.b.teardown();
    if (state === 'ended') this.onended?.();
  }
}

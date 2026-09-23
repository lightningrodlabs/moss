/**
 * The Tool-side half of an audio-source grant's port protocol, kept free of
 * Web Audio so it can be table-tested: the host streams Int16 frames and
 * finally posts `{type:'ended', reason}`; the Tool may post `{type:'close'}`.
 * Frames that arrive before the worklet module has loaded are queued and
 * flushed in order. Because the host sends silence frames continuously, a
 * gap longer than FRAME_GAP_TIMEOUT_MS means the port is dead (the host
 * renderer crashed or the port was closed without a message — a bare port
 * close is not observable as an event in the Chromium this ships on).
 */

export const FRAME_GAP_TIMEOUT_MS = 5000;

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
  private unknownMessages = 0;

  constructor(private readonly b: CaptureSessionBindings) {}

  stats(): CaptureSessionStats {
    return {
      framesReceived: this.framesReceived,
      framesQueuedBeforeReady: this.framesQueuedBeforeReady,
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

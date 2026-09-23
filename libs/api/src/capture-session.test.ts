import { describe, it, expect, vi } from 'vitest';
import { CaptureSession, CaptureSessionBindings, FRAME_GAP_TIMEOUT_MS } from './capture-session.js';

class FakeTimers {
  private timers = new Map<number, { fn: () => void; at: number }>();
  private next = 1;
  now = 0;
  setTimeout = (fn: () => void, ms: number) => {
    const h = this.next++;
    this.timers.set(h, { fn, at: this.now + ms });
    return h;
  };
  clearTimeout = (h: unknown) => {
    this.timers.delete(h as number);
  };
  advance(ms: number) {
    this.now += ms;
    for (const [h, t] of [...this.timers]) {
      if (t.at <= this.now) {
        this.timers.delete(h);
        t.fn();
      }
    }
  }
  get pending() {
    return this.timers.size;
  }
}

function rig() {
  const timers = new FakeTimers();
  const forwarded: Int16Array[] = [];
  const b: CaptureSessionBindings = {
    forwardFrame: vi.fn((f: Int16Array) => void forwarded.push(f)),
    teardown: vi.fn(),
    postToHost: vi.fn(),
    closePort: vi.fn(),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  };
  const session = new CaptureSession(b);
  const onended = vi.fn();
  session.onended = onended;
  return { session, b, timers, forwarded, onended };
}

const frame = (v: number) => new Int16Array(960).fill(v);

describe('CaptureSession before ready', () => {
  it('starts in starting, holds frames, and forwards them in order on ready() (Review Focus 1)', () => {
    const r = rig();
    expect(r.session.state).toBe('starting');
    r.session.handlePortMessage(frame(1));
    r.session.handlePortMessage(frame(2));
    expect(r.b.forwardFrame).not.toHaveBeenCalled();
    r.session.ready();
    expect(r.session.state).toBe('live');
    expect(r.forwarded.map((f) => f[0])).toEqual([1, 2]);
    expect(r.session.stats()).toEqual({ framesReceived: 2, framesQueuedBeforeReady: 2, unknownMessages: 0 });
  });

  it('an ended message before ready still ends the session and fires onended once', () => {
    const r = rig();
    r.session.handlePortMessage({ type: 'ended', reason: 'user-stopped' });
    expect(r.session.state).toBe('ended');
    expect(r.session.endedReason).toBe('user-stopped');
    expect(r.onended).toHaveBeenCalledTimes(1);
    r.session.ready();
    expect(r.session.state).toBe('ended');
    expect(r.b.forwardFrame).not.toHaveBeenCalled();
  });
});

describe('CaptureSession live', () => {
  it('forwards frames and counts them', () => {
    const r = rig();
    r.session.ready();
    r.session.handlePortMessage(frame(7));
    expect(r.b.forwardFrame).toHaveBeenCalledTimes(1);
    expect(r.session.stats().framesReceived).toBe(1);
  });

  it('ignores and counts messages that are neither frames nor known controls (Review Focus 3)', () => {
    const r = rig();
    r.session.ready();
    r.session.handlePortMessage('garbage');
    r.session.handlePortMessage({ type: 'unknown' });
    r.session.handlePortMessage(new Float32Array(4));
    expect(r.b.forwardFrame).not.toHaveBeenCalled();
    expect(r.session.stats().unknownMessages).toBe(3);
    expect(r.session.state).toBe('live');
  });

  it('host ended → teardown, port closed, onended once, no close message to the host', () => {
    const r = rig();
    r.session.ready();
    r.session.handlePortMessage({ type: 'ended', reason: 'stream-lost' });
    expect(r.session.state).toBe('ended');
    expect(r.session.endedReason).toBe('stream-lost');
    expect(r.b.teardown).toHaveBeenCalledTimes(1);
    expect(r.b.closePort).toHaveBeenCalledTimes(1);
    expect(r.b.postToHost).not.toHaveBeenCalled();
    expect(r.onended).toHaveBeenCalledTimes(1);
    expect(r.timers.pending).toBe(0);
  });

  it('frames after ended are dropped', () => {
    const r = rig();
    r.session.ready();
    r.session.handlePortMessage({ type: 'ended', reason: 'user-stopped' });
    r.session.handlePortMessage(frame(1));
    expect(r.b.forwardFrame).not.toHaveBeenCalled();
  });
});

describe('CaptureSession.stop (Tool-initiated)', () => {
  it('posts close, closes the port, tears down, never fires onended (Review Focus 2)', () => {
    const r = rig();
    r.session.ready();
    r.session.stop();
    expect(r.session.state).toBe('stopped');
    expect(r.b.postToHost).toHaveBeenCalledWith({ type: 'close' });
    expect(r.b.closePort).toHaveBeenCalledTimes(1);
    expect(r.b.teardown).toHaveBeenCalledTimes(1);
    expect(r.onended).not.toHaveBeenCalled();
    expect(r.timers.pending).toBe(0);
  });

  it('stop twice is a no-op the second time', () => {
    const r = rig();
    r.session.ready();
    r.session.stop();
    r.session.stop();
    expect(r.b.postToHost).toHaveBeenCalledTimes(1);
    expect(r.b.teardown).toHaveBeenCalledTimes(1);
  });

  it('stop after the host ended is a no-op', () => {
    const r = rig();
    r.session.ready();
    r.session.handlePortMessage({ type: 'ended', reason: 'user-stopped' });
    r.session.stop();
    expect(r.b.postToHost).not.toHaveBeenCalled();
    expect(r.b.teardown).toHaveBeenCalledTimes(1);
    expect(r.session.state).toBe('ended');
  });

  it('stop before ready works and later ready() is a no-op', () => {
    const r = rig();
    r.session.stop();
    r.session.ready();
    expect(r.session.state).toBe('stopped');
    expect(r.b.postToHost).toHaveBeenCalledTimes(1);
  });
});

describe('frame-gap watchdog (Review Focus 4)', () => {
  it('is armed on ready and re-armed by every frame', () => {
    const r = rig();
    r.session.ready();
    r.timers.advance(FRAME_GAP_TIMEOUT_MS - 1);
    r.session.handlePortMessage(frame(1));
    r.timers.advance(FRAME_GAP_TIMEOUT_MS - 1);
    expect(r.session.state).toBe('live');
    r.timers.advance(1);
    expect(r.session.state).toBe('ended');
    expect(r.session.endedReason).toBe('host-silent');
    expect(r.onended).toHaveBeenCalledTimes(1);
    expect(r.b.teardown).toHaveBeenCalledTimes(1);
    expect(r.b.closePort).toHaveBeenCalledTimes(1);
  });

  it('is not armed before ready (the host may legitimately be slow to start)', () => {
    const r = rig();
    r.timers.advance(FRAME_GAP_TIMEOUT_MS * 3);
    expect(r.session.state).toBe('starting');
  });

  it('is disarmed by stop', () => {
    const r = rig();
    r.session.ready();
    r.session.stop();
    r.timers.advance(FRAME_GAP_TIMEOUT_MS + 1);
    expect(r.onended).not.toHaveBeenCalled();
  });
});

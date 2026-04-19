import { describe, expect, it, vi } from 'vitest';

import {
  AsrIncomingEvent,
  AsrSessionRequest,
  AsrTransport,
  openAsrSession,
} from '../asr';

interface FakeTransport extends AsrTransport {
  sent: AsrSessionRequest[];
  emit: (event: AsrIncomingEvent) => void;
}

function makeTransport(opts: {
  openSessionId?: string;
  sendImpl?: (req: AsrSessionRequest) => Promise<unknown>;
} = {}): FakeTransport {
  const sent: AsrSessionRequest[] = [];
  const subscribers = new Set<(ev: AsrIncomingEvent) => void>();
  const transport: FakeTransport = {
    sent,
    emit: (ev) => subscribers.forEach((cb) => cb(ev)),
    send: async (request) => {
      sent.push(request);
      if (opts.sendImpl) return opts.sendImpl(request);
      if (request.type === 'asr-open-session') {
        return { sessionId: opts.openSessionId ?? 'sid-1' };
      }
      return undefined;
    },
    subscribe: (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
  };
  return transport;
}

describe('openAsrSession', () => {
  it('returns a session with the id supplied by the parent reply', async () => {
    const t = makeTransport({ openSessionId: 'abc-123' });
    const session = await openAsrSession(t, { language: 'en' });
    expect(session.sessionId).toBe('abc-123');
    expect(t.sent[0]).toEqual({
      type: 'asr-open-session',
      opts: { language: 'en' },
    });
  });

  it('throws when the parent returns a malformed reply', async () => {
    const t = makeTransport({ sendImpl: async () => ({ wrong: true }) });
    await expect(openAsrSession(t)).rejects.toThrow(/Bad asr-open-session reply/);
  });
});

describe('AsrSession.pushAudio', () => {
  it('sends PCM bytes (and the endOfUtterance flag) to the parent', async () => {
    const t = makeTransport();
    const session = await openAsrSession(t);
    const pcm = new Int16Array([1, 2, 3, 4]);
    await session.pushAudio(pcm, true);
    const last = t.sent.at(-1)!;
    expect(last.type).toBe('asr-push-audio');
    if (last.type === 'asr-push-audio') {
      expect(last.sessionId).toBe('sid-1');
      expect(last.endOfUtterance).toBe(true);
      // bytes should be the underlying buffer of the Int16Array
      expect(Array.from(last.pcm)).toEqual(
        Array.from(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)),
      );
    }
  });

  it('rejects after close()', async () => {
    const t = makeTransport();
    const session = await openAsrSession(t);
    await session.close();
    await expect(session.pushAudio(new Int16Array(2))).rejects.toThrow(/closed/);
  });
});

describe('AsrSession event delivery', () => {
  it('routes final events whose sessionId matches', async () => {
    const t = makeTransport();
    const session = await openAsrSession(t);
    const finals: Array<{ text: string }> = [];
    session.onFinal((ev) => finals.push(ev));

    t.emit({
      sessionId: 'sid-1',
      eventType: 'final',
      text: 'hello world',
      tStart: 0,
      tEnd: 1_000,
    });
    t.emit({
      sessionId: 'other-session',
      eventType: 'final',
      text: 'should not arrive',
      tStart: 0,
      tEnd: 1_000,
    });

    expect(finals).toHaveLength(1);
    expect(finals[0].text).toBe('hello world');
  });

  it('routes error events to onError callbacks', async () => {
    const t = makeTransport();
    const session = await openAsrSession(t);
    const errors: Error[] = [];
    session.onError((e) => errors.push(e));
    t.emit({ sessionId: 'sid-1', eventType: 'error', error: 'kaboom' });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('kaboom');
  });

  it('unsubscribe returned by onFinal stops further deliveries', async () => {
    const t = makeTransport();
    const session = await openAsrSession(t);
    const finals: Array<{ text: string }> = [];
    const off = session.onFinal((ev) => finals.push(ev));
    t.emit({ sessionId: 'sid-1', eventType: 'final', text: 'one', tStart: 0, tEnd: 1 });
    off();
    t.emit({ sessionId: 'sid-1', eventType: 'final', text: 'two', tStart: 0, tEnd: 1 });
    expect(finals.map((f) => f.text)).toEqual(['one']);
  });

  it('listener errors do not break delivery to other listeners', async () => {
    const t = makeTransport();
    const session = await openAsrSession(t);
    const seen: string[] = [];
    session.onFinal(() => {
      throw new Error('listener bad');
    });
    session.onFinal((ev) => seen.push(ev.text));
    t.emit({ sessionId: 'sid-1', eventType: 'final', text: 'survives', tStart: 0, tEnd: 1 });
    expect(seen).toEqual(['survives']);
  });

  it('onPartial returns a no-op unsubscribe and never fires (v1)', async () => {
    const t = makeTransport();
    const session = await openAsrSession(t);
    const calls: unknown[] = [];
    const off = session.onPartial(() => calls.push(1));
    expect(typeof off).toBe('function');
    expect(calls).toEqual([]);
  });
});

describe('AsrSession.close', () => {
  it('sends asr-close-session to the parent', async () => {
    const t = makeTransport();
    const session = await openAsrSession(t);
    await session.close();
    const last = t.sent.at(-1)!;
    expect(last).toEqual({ type: 'asr-close-session', sessionId: 'sid-1' });
  });

  it('is idempotent', async () => {
    const t = makeTransport();
    const session = await openAsrSession(t);
    await session.close();
    const beforeSent = t.sent.length;
    await session.close();
    expect(t.sent.length).toBe(beforeSent);
  });

  it('swallows transport errors during close()', async () => {
    const t = makeTransport({
      sendImpl: async (req) => {
        if (req.type === 'asr-open-session') return { sessionId: 'sid-1' };
        throw new Error('parent gone');
      },
    });
    const session = await openAsrSession(t);
    await expect(session.close()).resolves.toBeUndefined();
  });

  it('unsubscribes from the transport so events stop firing on closed sessions', async () => {
    const t = makeTransport();
    const session = await openAsrSession(t);
    const finals: Array<{ text: string }> = [];
    session.onFinal((ev) => finals.push(ev));
    await session.close();
    t.emit({ sessionId: 'sid-1', eventType: 'final', text: 'after close', tStart: 0, tEnd: 1 });
    expect(finals).toHaveLength(0);
  });
});

describe('AsrSession id isolation', () => {
  it('parallel sessions only see their own events', async () => {
    let n = 0;
    const t = makeTransport({ sendImpl: async (req) => {
      if (req.type === 'asr-open-session') return { sessionId: `sid-${++n}` };
      return undefined;
    } });
    // Re-use the same transport for two sessions; the FakeTransport
    // broadcasts events to all subscribers so each AsrSession sees them
    // and filters by its own id.
    const a = await openAsrSession(t);
    const b = await openAsrSession(t);
    expect(a.sessionId).toBe('sid-1');
    expect(b.sessionId).toBe('sid-2');

    const aFinals: string[] = [];
    const bFinals: string[] = [];
    a.onFinal((ev) => aFinals.push(ev.text));
    b.onFinal((ev) => bFinals.push(ev.text));

    t.emit({ sessionId: 'sid-1', eventType: 'final', text: 'A', tStart: 0, tEnd: 1 });
    t.emit({ sessionId: 'sid-2', eventType: 'final', text: 'B', tStart: 0, tEnd: 1 });

    expect(aFinals).toEqual(['A']);
    expect(bFinals).toEqual(['B']);

    // Avoid the unused-variable warning for vi (kept as a hook for future tests)
    vi.fn();
  });
});

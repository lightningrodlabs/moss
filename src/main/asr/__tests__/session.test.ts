import { describe, expect, it, vi } from 'vitest';

import { AsrFinalEvent, AsrSession, AsrSessionStateError } from '../session';
import { FakeWhisperServer, asWhisperServer } from './fakeWhisperServer';

function makeReadyServer(opts?: ConstructorParameters<typeof FakeWhisperServer>[1]) {
  const fake = new FakeWhisperServer({ command: ['noop'], modelPath: '/dev/null' }, opts);
  fake.state = 'ready';
  return fake;
}

function silentPcm(samples: number): Int16Array {
  return new Int16Array(samples);
}

describe('AsrSession', () => {
  it('emits a final event when pushAudio is called with endOfUtterance', async () => {
    const fake = makeReadyServer({
      transcribe: () => ({
        segments: [{ text: 'hello world', tStart: 100, tEnd: 800 }],
        inferMs: 5,
      }),
    });
    const onClose = vi.fn();
    const session = new AsrSession(asWhisperServer(fake), onClose);

    const finals: AsrFinalEvent[] = [];
    session.onFinal((ev) => finals.push(ev));

    // 1 second of mono @ 16 kHz = 16000 samples
    await session.pushAudio(silentPcm(16_000), true);

    expect(finals).toHaveLength(1);
    expect(finals[0].text).toBe('hello world');
    expect(finals[0].tStart).toBe(100);
    expect(finals[0].tEnd).toBe(800);
    expect(fake.transcribeCalls).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offsets segment timestamps by the per-session cursor across multiple flushes', async () => {
    let call = 0;
    const fake = makeReadyServer({
      transcribe: () => {
        call += 1;
        return {
          segments: [{ text: `seg${call}`, tStart: 0, tEnd: 500 }],
          inferMs: 1,
        };
      },
    });
    const session = new AsrSession(asWhisperServer(fake), () => {});
    const finals: AsrFinalEvent[] = [];
    session.onFinal((ev) => finals.push(ev));

    await session.pushAudio(silentPcm(16_000), true); // 1 s
    await session.pushAudio(silentPcm(8_000), true); // 0.5 s
    await session.pushAudio(silentPcm(16_000), true); // 1 s

    expect(finals.map((f) => f.text)).toEqual(['seg1', 'seg2', 'seg3']);
    expect(finals[0].tStart).toBe(0);
    expect(finals[0].tEnd).toBe(500);
    // Second flush base = 1000 ms (after the 1 s push)
    expect(finals[1].tStart).toBe(1_000);
    expect(finals[1].tEnd).toBe(1_500);
    // Third flush base = 1500 ms (after 1 s + 0.5 s)
    expect(finals[2].tStart).toBe(1_500);
    expect(finals[2].tEnd).toBe(2_000);
  });

  it('force-flushes when buffered audio exceeds maxBufferMs', async () => {
    const fake = makeReadyServer();
    const session = new AsrSession(asWhisperServer(fake), () => {}, {
      maxBufferMs: 500, // half a second
    });
    // Push 600 ms without endOfUtterance — must force a flush.
    await session.pushAudio(silentPcm(16_000 * 0.6), false);
    expect(fake.transcribeCalls).toHaveLength(1);
  });

  it('does NOT flush when there is no audio buffered, even on endOfUtterance', async () => {
    const fake = makeReadyServer();
    const session = new AsrSession(asWhisperServer(fake), () => {});
    await session.pushAudio(new Int16Array(0), true);
    expect(fake.transcribeCalls).toHaveLength(0);
  });

  it('flushes pending buffer on close() and calls onClose exactly once', async () => {
    const fake = makeReadyServer();
    const onClose = vi.fn();
    const session = new AsrSession(asWhisperServer(fake), onClose);
    await session.pushAudio(silentPcm(8_000), false); // buffered, no flush
    expect(fake.transcribeCalls).toHaveLength(0);
    await session.close();
    expect(fake.transcribeCalls).toHaveLength(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    // Idempotent
    await session.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('rejects pushAudio after close()', async () => {
    const fake = makeReadyServer();
    const session = new AsrSession(asWhisperServer(fake), () => {});
    await session.close();
    await expect(session.pushAudio(silentPcm(16_000), true)).rejects.toBeInstanceOf(
      AsrSessionStateError,
    );
  });

  it('serializes overlapping pushAudio calls so finals stay in order', async () => {
    let order = 0;
    const fake = makeReadyServer({
      transcribe: () => {
        order += 1;
        const i = order;
        return {
          segments: [{ text: `seg${i}`, tStart: 0, tEnd: 100 }],
          inferMs: 1,
        };
      },
    });
    const session = new AsrSession(asWhisperServer(fake), () => {});
    const finals: AsrFinalEvent[] = [];
    session.onFinal((ev) => finals.push(ev));

    // Fire three pushes without awaiting; they should still flush in order.
    const a = session.pushAudio(silentPcm(16_000), true);
    const b = session.pushAudio(silentPcm(16_000), true);
    const c = session.pushAudio(silentPcm(16_000), true);
    await Promise.all([a, b, c]);

    expect(finals.map((f) => f.text)).toEqual(['seg1', 'seg2', 'seg3']);
  });

  it('emits an error event AND rejects pushAudio when the server errors', async () => {
    const fake = makeReadyServer({
      transcribe: () => {
        throw new Error('whisper-server exploded');
      },
    });
    const session = new AsrSession(asWhisperServer(fake), () => {});
    const errors: Error[] = [];
    session.onError((e) => errors.push(e));

    await expect(session.pushAudio(silentPcm(16_000), true)).rejects.toThrow(/exploded/);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/exploded/);
  });

  it('unsubscribes listeners returned by onFinal/onError', async () => {
    const fake = makeReadyServer();
    const session = new AsrSession(asWhisperServer(fake), () => {});
    const finals: AsrFinalEvent[] = [];
    const off = session.onFinal((ev) => finals.push(ev));

    await session.pushAudio(silentPcm(16_000), true);
    expect(finals).toHaveLength(1);
    off();
    await session.pushAudio(silentPcm(16_000), true);
    expect(finals).toHaveLength(1); // no new event
  });
});

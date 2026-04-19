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

/** PCM at constant amplitude — RMS = `amplitude` (normalized). */
function speechPcm(samples: number, amplitude = 0.3): Int16Array {
  const out = new Int16Array(samples);
  const v = Math.round(amplitude * 32767);
  for (let i = 0; i < samples; i++) out[i] = v;
  return out;
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

describe('AsrSession VAD', () => {
  // 16 kHz mono. 1600 samples = 100 ms. Tests run with vadSilenceMs:
  // 200 (= 3200 samples = 2 chunks of 100 ms), vadSilenceRms: 0.05
  // (well below the 0.3 amplitude of speechPcm and well above
  // silentPcm's 0).

  function vadSession(server = makeReadyServer(), opts = {}) {
    return new AsrSession(asWhisperServer(server), () => {}, {
      vadSilenceMs: 200,
      vadSilenceRms: 0.05,
      ...opts,
    });
  }

  it('does not flush on silence alone (no preceding speech)', async () => {
    const fake = makeReadyServer();
    const session = vadSession(fake);
    // 5 chunks of 100 ms silence — 500 ms total, well past vadSilenceMs.
    for (let i = 0; i < 5; i++) {
      await session.pushAudio(silentPcm(1600), false);
    }
    expect(fake.transcribeCalls).toHaveLength(0);
  });

  it('flushes after vadSilenceMs of silence following speech', async () => {
    const fake = makeReadyServer();
    const session = vadSession(fake);
    await session.pushAudio(speechPcm(1600), false); // 100 ms speech
    expect(fake.transcribeCalls).toHaveLength(0);
    await session.pushAudio(silentPcm(1600), false); // 100 ms silence — not yet
    expect(fake.transcribeCalls).toHaveLength(0);
    await session.pushAudio(silentPcm(1600), false); // another 100 ms — total 200 ms → flush
    expect(fake.transcribeCalls).toHaveLength(1);
  });

  it('does NOT flush when silence is shorter than vadSilenceMs', async () => {
    const fake = makeReadyServer();
    const session = vadSession(fake);
    await session.pushAudio(speechPcm(1600), false);
    await session.pushAudio(silentPcm(1600), false); // 100 ms silence — under 200 ms
    await session.pushAudio(speechPcm(1600), false); // resumes speech, resets silence accum
    await session.pushAudio(silentPcm(1600), false); // 100 ms silence again — still under
    expect(fake.transcribeCalls).toHaveLength(0);
  });

  it('starts a fresh utterance after a VAD-triggered flush', async () => {
    const fake = makeReadyServer();
    const session = vadSession(fake);
    // First utterance: speech + 200 ms silence → flush 1
    await session.pushAudio(speechPcm(1600), false);
    await session.pushAudio(silentPcm(1600), false);
    await session.pushAudio(silentPcm(1600), false);
    expect(fake.transcribeCalls).toHaveLength(1);
    // Pure silence after the flush should NOT immediately re-trigger.
    await session.pushAudio(silentPcm(1600), false);
    await session.pushAudio(silentPcm(1600), false);
    expect(fake.transcribeCalls).toHaveLength(1);
    // Second utterance: speech + silence → flush 2
    await session.pushAudio(speechPcm(1600), false);
    await session.pushAudio(silentPcm(1600), false);
    await session.pushAudio(silentPcm(1600), false);
    expect(fake.transcribeCalls).toHaveLength(2);
  });

  it('emits ordered finals with cursor advancing across VAD-driven flushes', async () => {
    let n = 0;
    const fake = makeReadyServer({
      transcribe: () => {
        n += 1;
        return {
          segments: [{ text: `utt${n}`, tStart: 0, tEnd: 100 }],
          inferMs: 1,
        };
      },
    });
    const session = vadSession(fake);
    const finals: AsrFinalEvent[] = [];
    session.onFinal((ev) => finals.push(ev));

    // Utterance 1: 100 ms speech + 200 ms silence (3 chunks total = 300 ms)
    await session.pushAudio(speechPcm(1600), false);
    await session.pushAudio(silentPcm(1600), false);
    await session.pushAudio(silentPcm(1600), false);

    // Utterance 2: 100 ms speech + 200 ms silence (another 300 ms)
    await session.pushAudio(speechPcm(1600), false);
    await session.pushAudio(silentPcm(1600), false);
    await session.pushAudio(silentPcm(1600), false);

    expect(finals.map((f) => f.text)).toEqual(['utt1', 'utt2']);
    expect(finals[0].tStart).toBe(0);
    // Second utterance starts at the cursor advanced by the first
    // flush (3 × 100 ms = 300 ms).
    expect(finals[1].tStart).toBe(300);
  });

  it('vad: false disables silence-triggered flushes', async () => {
    const fake = makeReadyServer();
    const session = new AsrSession(asWhisperServer(fake), () => {}, {
      vad: false,
      vadSilenceMs: 100, // small, would otherwise easily fire
      vadSilenceRms: 0.05,
    });
    await session.pushAudio(speechPcm(1600), false);
    for (let i = 0; i < 10; i++) {
      await session.pushAudio(silentPcm(1600), false); // 1 second of silence
    }
    expect(fake.transcribeCalls).toHaveLength(0);
  });

  it('endOfUtterance still wins regardless of VAD state', async () => {
    const fake = makeReadyServer();
    const session = vadSession(fake);
    await session.pushAudio(speechPcm(1600), false); // speech, no silence yet
    await session.pushAudio(speechPcm(1600), true); // explicit commit mid-speech
    expect(fake.transcribeCalls).toHaveLength(1);
  });

  it('ignores chunks below vadSilenceRms in pre-speech state', async () => {
    const fake = makeReadyServer();
    const session = vadSession(fake);
    // Tiny non-zero noise: amplitude 0.01 → RMS 0.01, below the 0.05 threshold.
    const quietNoise = speechPcm(1600, 0.01);
    for (let i = 0; i < 10; i++) {
      await session.pushAudio(quietNoise, false);
    }
    expect(fake.transcribeCalls).toHaveLength(0);
  });
});

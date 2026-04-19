import { describe, expect, it } from 'vitest';

import { AsrBroker } from '../broker';
import { AsrFinalEvent } from '../session';
import { FakeWhisperServer, asWhisperServer } from './fakeWhisperServer';

interface BrokerHandle {
  broker: AsrBroker;
  /** Fakes the broker has minted via its factory. */
  fakes: FakeWhisperServer[];
}

function makeBroker(opts: {
  idleTimeoutMs?: number;
  startDelayMs?: number;
  transcribeText?: string;
} = {}): BrokerHandle {
  const fakes: FakeWhisperServer[] = [];
  const broker = new AsrBroker({
    server: { command: ['noop'], modelPath: '/dev/null' },
    idleTimeoutMs: opts.idleTimeoutMs,
    serverFactory: (cfg) => {
      const fake = new FakeWhisperServer(cfg, {
        startDelayMs: opts.startDelayMs,
        transcribe: opts.transcribeText
          ? () => ({
              segments: [{ text: opts.transcribeText!, tStart: 0, tEnd: 0 }],
              inferMs: 1,
            })
          : undefined,
      });
      fakes.push(fake);
      return asWhisperServer(fake);
    },
  });
  return { broker, fakes };
}

function silentPcm(samples: number): Int16Array {
  return new Int16Array(samples);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('AsrBroker', () => {
  it('lazy-loads the server only on first openSession()', async () => {
    const { broker, fakes } = makeBroker();
    expect(broker.isLoaded).toBe(false);
    expect(fakes).toHaveLength(0);

    const session = await broker.openSession();
    expect(broker.isLoaded).toBe(true);
    expect(fakes).toHaveLength(1);
    expect(fakes[0].startCalls).toBe(1);
    expect(broker.openSessionCount).toBe(1);

    await session.close();
    await broker.destroy();
  });

  it('shares one server across multiple concurrent openSession() calls', async () => {
    const { broker, fakes } = makeBroker({ startDelayMs: 50 });
    const [a, b, c] = await Promise.all([
      broker.openSession(),
      broker.openSession(),
      broker.openSession(),
    ]);
    expect(fakes).toHaveLength(1);
    expect(fakes[0].startCalls).toBe(1);
    expect(broker.openSessionCount).toBe(3);

    await Promise.all([a.close(), b.close(), c.close()]);
    await broker.destroy();
  });

  it('unloads the server after the idle timeout elapses with no sessions', async () => {
    const { broker, fakes } = makeBroker({ idleTimeoutMs: 50 });
    const session = await broker.openSession();
    await session.close();
    expect(broker.isLoaded).toBe(true); // not yet idle-fired

    await sleep(120);
    expect(broker.isLoaded).toBe(false);
    expect(fakes[0].stopCalls).toBe(1);
    await broker.destroy();
  });

  it('cancels a pending unload if a new session arrives before the timer fires', async () => {
    const { broker, fakes } = makeBroker({ idleTimeoutMs: 200 });
    const a = await broker.openSession();
    await a.close();
    // Within the idle window, ask for another session — must reuse.
    await sleep(50);
    const b = await broker.openSession();
    expect(fakes).toHaveLength(1);
    expect(fakes[0].startCalls).toBe(1);
    expect(broker.isLoaded).toBe(true);

    // Wait past the original idle window; server still alive (timer cancelled).
    await sleep(200);
    expect(broker.isLoaded).toBe(true);
    await b.close();
    await broker.destroy();
  });

  it('starts a fresh server after idle unload completes', async () => {
    const { broker, fakes } = makeBroker({ idleTimeoutMs: 30 });
    const a = await broker.openSession();
    await a.close();
    await sleep(80); // unload fires
    expect(broker.isLoaded).toBe(false);

    const b = await broker.openSession();
    expect(fakes).toHaveLength(2);
    expect(fakes[1].startCalls).toBe(1);

    await b.close();
    await broker.destroy();
  });

  it('routes session pushAudio through the shared server', async () => {
    const { broker, fakes } = makeBroker({ transcribeText: 'broker-routed' });
    const session = await broker.openSession();
    const finals: AsrFinalEvent[] = [];
    session.onFinal((ev) => finals.push(ev));

    await session.pushAudio(silentPcm(16_000), true);
    expect(finals).toHaveLength(1);
    expect(finals[0].text).toBe('broker-routed');
    expect(fakes[0].transcribeCalls).toHaveLength(1);

    await session.close();
    await broker.destroy();
  });

  it('rejects openSession() after destroy()', async () => {
    const { broker } = makeBroker();
    await broker.destroy();
    await expect(broker.openSession()).rejects.toThrow(/destroyed/);
  });

  it('idleTimeoutMs=0 unloads immediately on session close', async () => {
    const { broker, fakes } = makeBroker({ idleTimeoutMs: 0 });
    const session = await broker.openSession();
    await session.close();
    // No setTimeout to wait for; release awaits unload directly.
    expect(broker.isLoaded).toBe(false);
    expect(fakes[0].stopCalls).toBe(1);
    await broker.destroy();
  });
});

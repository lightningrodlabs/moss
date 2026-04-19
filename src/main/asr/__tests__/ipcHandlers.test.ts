import { describe, expect, it, vi } from 'vitest';

import { AsrBroker } from '../broker';
import {
  AsrIpcError,
  AsrIpcEvent,
  AsrIpcHandlerContext,
  asrCloseAllForOwner,
  asrCloseSession,
  asrOpenSession,
  asrPushAudio,
} from '../ipcHandlers';
import { SessionRegistry } from '../sessionRegistry';
import { FakeWhisperServer, asWhisperServer } from './fakeWhisperServer';

interface Harness {
  ctx: AsrIpcHandlerContext;
  events: Array<{ ownerId: number; event: AsrIpcEvent }>;
  fakes: FakeWhisperServer[];
  registry: SessionRegistry;
}

function makeHarness(opts: { transcribeText?: string; idGen?: () => string } = {}): Harness {
  const fakes: FakeWhisperServer[] = [];
  const broker = new AsrBroker({
    server: { command: ['noop'], modelPath: '/dev/null' },
    serverFactory: (cfg) => {
      const fake = new FakeWhisperServer(cfg, {
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
  const registry = new SessionRegistry(opts.idGen);
  const events: Harness['events'] = [];
  return {
    ctx: {
      getBroker: () => broker,
      registry,
      emitEvent: (ownerId, event) => events.push({ ownerId, event }),
    },
    events,
    fakes,
    registry,
  };
}

function silentBytes(samples: number): Uint8Array {
  return new Uint8Array(samples * 2);
}

describe('asrOpenSession', () => {
  it('registers a session under the owner and returns a fresh id', async () => {
    let n = 0;
    const h = makeHarness({ idGen: () => `id-${n++}` });
    const { sessionId } = await asrOpenSession(h.ctx, 100, {});
    expect(sessionId).toBe('id-0');
    expect(h.registry.size).toBe(1);
    expect(h.registry.get(sessionId)?.ownerId).toBe(100);
  });

  it('forwards final events to the owner via emitEvent', async () => {
    const h = makeHarness({ transcribeText: 'hello there' });
    const { sessionId } = await asrOpenSession(h.ctx, 42, {});
    await asrPushAudio(h.ctx, 42, {
      sessionId,
      pcm: silentBytes(16_000),
      endOfUtterance: true,
    });
    expect(h.events).toHaveLength(1);
    const ev = h.events[0];
    expect(ev.ownerId).toBe(42);
    expect(ev.event.eventType).toBe('final');
    if (ev.event.eventType === 'final') {
      expect(ev.event.text).toBe('hello there');
      expect(ev.event.sessionId).toBe(sessionId);
    }
  });
});

describe('asrPushAudio', () => {
  it('routes PCM bytes through to the AsrSession', async () => {
    const h = makeHarness();
    const { sessionId } = await asrOpenSession(h.ctx, 1, {});
    await asrPushAudio(h.ctx, 1, {
      sessionId,
      pcm: silentBytes(16_000),
      endOfUtterance: true,
    });
    expect(h.fakes[0].transcribeCalls).toHaveLength(1);
  });

  it('throws not_found for an unknown session id', async () => {
    const h = makeHarness();
    await expect(
      asrPushAudio(h.ctx, 1, { sessionId: 'nope', pcm: silentBytes(16) }),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('throws forbidden when a different owner tries to push', async () => {
    const h = makeHarness();
    const { sessionId } = await asrOpenSession(h.ctx, 100, {});
    await expect(
      asrPushAudio(h.ctx, 200, { sessionId, pcm: silentBytes(16) }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('throws invalid for an odd-length PCM payload', async () => {
    const h = makeHarness();
    const { sessionId } = await asrOpenSession(h.ctx, 1, {});
    await expect(
      asrPushAudio(h.ctx, 1, { sessionId, pcm: new Uint8Array(3) }),
    ).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('emits an error event when the underlying session throws', async () => {
    const fakes: FakeWhisperServer[] = [];
    const broker = new AsrBroker({
      server: { command: ['noop'], modelPath: '/dev/null' },
      serverFactory: (cfg) => {
        const fake = new FakeWhisperServer(cfg, {
          transcribe: () => {
            throw new Error('boom');
          },
        });
        fakes.push(fake);
        return asWhisperServer(fake);
      },
    });
    const registry = new SessionRegistry();
    const events: Array<{ ownerId: number; event: AsrIpcEvent }> = [];
    const ctx: AsrIpcHandlerContext = {
      getBroker: () => broker,
      registry,
      emitEvent: (ownerId, event) => events.push({ ownerId, event }),
    };
    const { sessionId } = await asrOpenSession(ctx, 1, {});
    await expect(
      asrPushAudio(ctx, 1, { sessionId, pcm: silentBytes(16_000), endOfUtterance: true }),
    ).rejects.toThrow(/boom/);
    expect(events).toHaveLength(1);
    expect(events[0].event.eventType).toBe('error');
    if (events[0].event.eventType === 'error') {
      expect(events[0].event.error).toMatch(/boom/);
    }
  });
});

describe('asrCloseSession', () => {
  it('removes the entry and closes the session', async () => {
    const h = makeHarness();
    const { sessionId } = await asrOpenSession(h.ctx, 1, {});
    expect(h.registry.size).toBe(1);
    await asrCloseSession(h.ctx, 1, { sessionId });
    expect(h.registry.size).toBe(0);
  });

  it('is a no-op for an unknown session id', async () => {
    const h = makeHarness();
    await asrCloseSession(h.ctx, 1, { sessionId: 'nope' });
    // no throw, no change
    expect(h.registry.size).toBe(0);
  });

  it('throws forbidden when a different owner tries to close', async () => {
    const h = makeHarness();
    const { sessionId } = await asrOpenSession(h.ctx, 100, {});
    await expect(asrCloseSession(h.ctx, 200, { sessionId })).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });
});

describe('asrCloseAllForOwner', () => {
  it('closes every session of the owner and leaves others alone', async () => {
    const h = makeHarness();
    await asrOpenSession(h.ctx, 100, {});
    await asrOpenSession(h.ctx, 100, {});
    await asrOpenSession(h.ctx, 200, {});
    expect(h.registry.size).toBe(3);

    await asrCloseAllForOwner(h.ctx, 100);
    expect(h.registry.size).toBe(1);
    expect(h.registry.idsForOwner(100)).toEqual([]);
    expect(h.registry.idsForOwner(200)).toHaveLength(1);
  });

  it('swallows errors from individual close() calls', async () => {
    const h = makeHarness();
    const { sessionId } = await asrOpenSession(h.ctx, 100, {});
    const entry = h.registry.get(sessionId)!;
    vi.spyOn(entry.session, 'close').mockRejectedValue(new Error('cleanup boom'));
    await expect(asrCloseAllForOwner(h.ctx, 100)).resolves.toBeUndefined();
  });
});

describe('AsrIpcError', () => {
  it('preserves the kind tag', () => {
    const err = new AsrIpcError('x', 'forbidden');
    expect(err.kind).toBe('forbidden');
    expect(err.name).toBe('AsrIpcError');
  });
});

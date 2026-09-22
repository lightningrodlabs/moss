import { describe, it, expect, vi } from 'vitest';
import { AudioSourcePortReceiver, matchAudioSourcePortMessage, PORT_DELIVERY_TIMEOUT_MS } from './port-receiver';

const fakeWindow = {} as unknown as Window;

function portEvent(data: unknown, opts: { source?: unknown; ports?: MessagePort[] } = {}) {
  return { data, source: opts.source ?? fakeWindow, ports: opts.ports ?? [] } as unknown as MessageEvent;
}

describe('matchAudioSourcePortMessage', () => {
  it.each([
    [{ type: 'audio-source-port', requestId: 'r1', grantId: 'g1' }, { requestId: 'r1', grantId: 'g1' }],
    [{ type: 'audio-source-port', requestId: 'r1' }, null],
    [{ type: 'other', requestId: 'r1', grantId: 'g1' }, null],
    [null, null],
    ['string', null],
    [{ request: { type: 'ready' }, source: {} }, null],
  ])('%j → %j', (data, expected) => {
    expect(matchAudioSourcePortMessage(data)).toEqual(expected);
  });
});

describe('AudioSourcePortReceiver', () => {
  it('resolves an expected request with the transferred port', async () => {
    const r = new AudioSourcePortReceiver(fakeWindow, () => {});
    const { port1 } = new MessageChannel();
    const pending = r.expect('r1');
    r.handleMessage(portEvent({ type: 'audio-source-port', requestId: 'r1', grantId: 'g1' }, { ports: [port1] }));
    expect(await pending).toBe(port1);
  });

  it('expect alone never times out — no deadline is armed until armDeadline is called', async () => {
    vi.useFakeTimers();
    try {
      const r = new AudioSourcePortReceiver(fakeWindow, () => {});
      const pending = r.expect('r1');
      vi.advanceTimersByTime(PORT_DELIVERY_TIMEOUT_MS * 5);
      // Race against a promise that resolves on the next microtask: if
      // `pending` had already rejected (a timer fired), it would win the
      // race instead of the sentinel — Promise.race settles with whichever
      // input settles first, and a still-pending promise never does.
      const sentinel = Symbol('still pending');
      const raced = await Promise.race([pending, Promise.resolve(sentinel)]);
      expect(raced).toBe(sentinel);

      const { port1 } = new MessageChannel();
      r.handleMessage(portEvent({ type: 'audio-source-port', requestId: 'r1', grantId: 'g1' }, { ports: [port1] }));
      await expect(pending).resolves.toBe(port1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('armDeadline bounds a pending waiter; letting it elapse times out', async () => {
    vi.useFakeTimers();
    try {
      const r = new AudioSourcePortReceiver(fakeWindow, () => {});
      const pending = r.expect('r1');
      r.armDeadline('r1', 10);
      vi.advanceTimersByTime(10);
      await expect(pending).rejects.toThrow(/timed out/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('armDeadline is a no-op for an id that is not pending', () => {
    const r = new AudioSourcePortReceiver(fakeWindow, () => {});
    expect(() => r.armDeadline('nope', 10)).not.toThrow();
  });

  it('cancel rejects a pending waiter; a delivery that races in afterward is orphaned', async () => {
    const onOrphan = vi.fn();
    const r = new AudioSourcePortReceiver(fakeWindow, onOrphan);
    const pending = r.expect('r1');
    r.cancel('r1');
    await expect(pending).rejects.toThrow(/cancelled/);

    const { port1 } = new MessageChannel();
    let closed = false;
    port1.close = () => {
      closed = true;
    };
    r.handleMessage(portEvent({ type: 'audio-source-port', requestId: 'r1', grantId: 'g1' }, { ports: [port1] }));
    expect(closed).toBe(true);
    expect(onOrphan).toHaveBeenCalledWith('g1');
  });

  it('cancel is a no-op for an unknown id', () => {
    const r = new AudioSourcePortReceiver(fakeWindow, () => {});
    expect(() => r.cancel('nope')).not.toThrow();
  });

  it('ignores a message whose source is not this window (an iframe could forge the shape)', async () => {
    const r = new AudioSourcePortReceiver(fakeWindow, () => {});
    const { port1 } = new MessageChannel();
    const pending = r.expect('r1');
    r.armDeadline('r1', 20);
    r.handleMessage(
      portEvent({ type: 'audio-source-port', requestId: 'r1', grantId: 'g1' }, { source: {}, ports: [port1] }),
    );
    await expect(pending).rejects.toThrow(/timed out/);
  });

  it('a delivery nobody expects is dropped, its port closed, and onOrphan called', () => {
    const onOrphan = vi.fn();
    const r = new AudioSourcePortReceiver(fakeWindow, onOrphan);
    const { port1 } = new MessageChannel();
    let closed = false;
    port1.close = () => {
      closed = true;
    };
    r.handleMessage(portEvent({ type: 'audio-source-port', requestId: 'zz', grantId: 'g1' }, { ports: [port1] }));
    expect(closed).toBe(true);
    expect(onOrphan).toHaveBeenCalledOnce();
    expect(onOrphan).toHaveBeenCalledWith('g1');
  });

  it('a delivery with no port rejects the expectation', async () => {
    const r = new AudioSourcePortReceiver(fakeWindow, () => {});
    const pending = r.expect('r1');
    r.handleMessage(portEvent({ type: 'audio-source-port', requestId: 'r1', grantId: 'g1' }));
    await expect(pending).rejects.toThrow(/without a port/);
  });

  it('a second expect for the same requestId supersedes the first', async () => {
    const onOrphan = vi.fn();
    const r = new AudioSourcePortReceiver(fakeWindow, onOrphan);
    const first = r.expect('r1');
    const second = r.expect('r1');
    await expect(first).rejects.toThrow(/superseded/);
    const { port1 } = new MessageChannel();
    r.handleMessage(portEvent({ type: 'audio-source-port', requestId: 'r1', grantId: 'g1' }, { ports: [port1] }));
    expect(await second).toBe(port1);
    expect(onOrphan).not.toHaveBeenCalled();
  });

  it('a second expect supersedes a first that already had a deadline armed', async () => {
    const r = new AudioSourcePortReceiver(fakeWindow, () => {});
    const first = r.expect('r1');
    r.armDeadline('r1', 1000);
    const second = r.expect('r1');
    await expect(first).rejects.toThrow(/superseded/);
    const { port1 } = new MessageChannel();
    r.handleMessage(portEvent({ type: 'audio-source-port', requestId: 'r1', grantId: 'g1' }, { ports: [port1] }));
    expect(await second).toBe(port1);
  });

  it('times out when the deadline is armed and nothing arrives', async () => {
    const r = new AudioSourcePortReceiver(fakeWindow, () => {});
    const pending = r.expect('r1');
    r.armDeadline('r1', 10);
    await expect(pending).rejects.toThrow(/timed out/);
  });

  it('install subscribes to message events on the target', () => {
    const r = new AudioSourcePortReceiver(fakeWindow, () => {});
    const listeners: string[] = [];
    r.install({ addEventListener: (type: string) => listeners.push(type) });
    expect(listeners).toEqual(['message']);
  });
});

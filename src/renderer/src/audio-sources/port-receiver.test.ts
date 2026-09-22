import { describe, it, expect, vi } from 'vitest';
import { AudioSourcePortReceiver, matchAudioSourcePortMessage } from './port-receiver';

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
    const pending = r.expect('r1', 1000);
    r.handleMessage(portEvent({ type: 'audio-source-port', requestId: 'r1', grantId: 'g1' }, { ports: [port1] }));
    expect(await pending).toBe(port1);
  });

  it('ignores a message whose source is not this window (an iframe could forge the shape)', async () => {
    const r = new AudioSourcePortReceiver(fakeWindow, () => {});
    const { port1 } = new MessageChannel();
    const pending = r.expect('r1', 20);
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
    const pending = r.expect('r1', 1000);
    r.handleMessage(portEvent({ type: 'audio-source-port', requestId: 'r1', grantId: 'g1' }));
    await expect(pending).rejects.toThrow(/without a port/);
  });

  it('times out when nothing arrives', async () => {
    const r = new AudioSourcePortReceiver(fakeWindow, () => {});
    await expect(r.expect('r1', 10)).rejects.toThrow(/timed out/);
  });

  it('install subscribes to message events on the target', () => {
    const r = new AudioSourcePortReceiver(fakeWindow, () => {});
    const listeners: string[] = [];
    r.install({ addEventListener: (type: string) => listeners.push(type) });
    expect(listeners).toEqual(['message']);
  });
});

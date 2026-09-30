import { describe, it, expect, vi, afterEach } from 'vitest';
import { encodeHashToBase64 } from '@holochain/client';
import type { AppletToParentRequest, IframeKind, ParentToAppletMessage } from '@theweave/api';
import { toLowerCaseB64 } from '@theweave/utils';
import { AppletChannel, type FrameRegistry, type RequestHandler } from './applet-channel';

const APPLET_HASH = new Uint8Array([132, 32, 36, ...new Array(36).fill(7)]);
const APPLET_ID = encodeHashToBase64(APPLET_HASH);
const APPLET_ORIGIN = `applet://${toLowerCaseB64(APPLET_ID).replace(/\$/g, '%24')}`;

/**
 * Stands in for an iframe's contentWindow. It records what the host posts to
 * it, and can answer requests that carry a reply port.
 */
class FakeFrame {
  posted: ParentToAppletMessage[] = [];
  answer: ((message: ParentToAppletMessage, port: MessagePort) => void) | undefined;
  postMessage(message: ParentToAppletMessage, options?: { transfer?: Transferable[] }) {
    this.posted.push(message);
    const port = options?.transfer?.[0] as MessagePort | undefined;
    if (port && this.answer) this.answer(message, port);
  }
}

/**
 * An applet frame as the host sees it: cross-origin, so reading most of its
 * properties throws, as Chromium does for a cross-origin WindowProxy.
 */
class CrossOriginFrame extends FakeFrame {
  closed = false;
  get name(): string {
    throw new Error('SecurityError: Blocked a frame from accessing a cross-origin frame.');
  }
}

function registryWith(frames: Array<{ appletId: string; subType: string; source: unknown }>) {
  const registry: FrameRegistry = { appletIframes: {} };
  for (const f of frames) {
    (registry.appletIframes[f.appletId] ??= []).push({
      subType: f.subType,
      source: f.source as MessageEventSource,
    });
  }
  return registry;
}

function newChannel(registry: FrameRegistry = { appletIframes: {} }, isAppletDev = false) {
  return new AppletChannel({ registry, isAppletDev: () => isAppletDev, requestTimeoutMs: 50 });
}

/** Sends a request from `frame` and resolves with the reply the host posts back. */
async function sendRequest(
  channel: AppletChannel,
  handle: RequestHandler,
  frame: FakeFrame,
  request: unknown,
  origin = APPLET_ORIGIN,
): Promise<unknown> {
  const { port1, port2 } = new MessageChannel();
  const reply = new Promise((resolve) => {
    port1.onmessage = (m) => {
      port1.close();
      resolve(m.data);
    };
  });
  const claimed: IframeKind = {
    type: 'applet',
    appletHash: APPLET_HASH,
    groupHash: null,
    subType: 'main',
  };
  await channel.receive(
    {
      origin,
      source: frame,
      ports: [port2],
      data: { request, source: claimed },
    } as unknown as MessageEvent,
    handle,
  );
  return reply;
}

const echoType: RequestHandler = async (request) => `handled ${request.type}`;

afterEach(() => {
  vi.useRealTimers();
});

describe('AppletChannel: requests from frames', () => {
  it('replies success with the handler result, and passes the identity derived from the origin', async () => {
    const channel = newChannel();
    const frame = new FakeFrame();
    let seen: IframeKind | undefined;
    const reply = await sendRequest(
      channel,
      async (request, context) => {
        seen = context.kind;
        return `handled ${request.type}`;
      },
      frame,
      { type: 'user-select-screen' },
    );
    expect(reply).toEqual({ type: 'success', result: 'handled user-select-screen' });
    expect(seen).toMatchObject({ type: 'applet', subType: 'main' });
    expect(encodeHashToBase64((seen as { appletHash: Uint8Array }).appletHash)).toBe(APPLET_ID);
  });

  it('replies with an error, without running a handler, for a request that fails its schema check', async () => {
    const channel = newChannel();
    const handle = vi.fn(echoType);
    const reply = await sendRequest(channel, handle, new FakeFrame(), {
      type: 'request-audio-sources',
      pid: 5,
    });
    expect(reply).toMatchObject({ type: 'error' });
    expect((reply as { error: string }).error).toContain('request-audio-sources');
    expect(handle).not.toHaveBeenCalled();
  });

  it('replies with an error to a frame from an unrecognized origin', async () => {
    const channel = newChannel();
    const handle = vi.fn(echoType);
    const reply = await sendRequest(
      channel,
      handle,
      new FakeFrame(),
      { type: 'user-select-screen' },
      'https://evil.example',
    );
    expect(reply).toMatchObject({ type: 'error' });
    expect(handle).not.toHaveBeenCalled();
  });

  it('replies with the handler error when the handler throws', async () => {
    const channel = newChannel();
    const reply = await sendRequest(
      channel,
      async () => {
        throw new Error('no such applet');
      },
      new FakeFrame(),
      { type: 'user-select-screen' },
    );
    expect(reply).toEqual({ type: 'error', error: 'no such applet' });
  });

  it('ignores default-app frames, which have their own listener', async () => {
    const channel = newChannel();
    const handle = vi.fn(echoType);
    const { port2 } = new MessageChannel();
    await channel.receive(
      {
        origin: 'default-app://x',
        source: new FakeFrame(),
        ports: [port2],
        data: { request: { type: 'user-select-screen' } },
      } as unknown as MessageEvent,
      handle,
    );
    expect(handle).not.toHaveBeenCalled();
    port2.close();
  });

  it('ignores messages while the window does not yet know whether it runs in applet dev mode', async () => {
    const channel = new AppletChannel({
      registry: { appletIframes: {} },
      isAppletDev: () => undefined,
    });
    const handle = vi.fn(echoType);
    const { port2 } = new MessageChannel();
    await channel.receive(
      {
        origin: APPLET_ORIGIN,
        source: new FakeFrame(),
        ports: [port2],
        data: {},
      } as unknown as MessageEvent,
      handle,
    );
    expect(handle).not.toHaveBeenCalled();
    port2.close();
  });
});

describe('AppletChannel: readiness', () => {
  it('marks a frame ready when it reports ready, without calling the handler', async () => {
    const channel = newChannel();
    const frame = new FakeFrame();
    const handle = vi.fn(echoType);
    expect(channel.isReady(frame as unknown as MessageEventSource)).toBe(false);
    const reply = await sendRequest(channel, handle, frame, { type: 'ready' });
    expect(reply).toEqual({ type: 'success', result: undefined });
    expect(channel.isReady(frame as unknown as MessageEventSource)).toBe(true);
    expect(handle).not.toHaveBeenCalled();
  });

  it('tells two frames of the same applet apart', async () => {
    const first = new FakeFrame();
    const second = new FakeFrame();
    const channel = newChannel(
      registryWith([
        { appletId: APPLET_ID, subType: 'main', source: first },
        { appletId: APPLET_ID, subType: 'asset', source: second },
      ]),
    );
    await sendRequest(channel, echoType, second, { type: 'ready' });
    expect(channel.isReady(second as unknown as MessageEventSource)).toBe(true);
    expect(channel.isReady(first as unknown as MessageEventSource)).toBe(false);
  });

  it('resolves a wait for an applet view once that view reports ready', async () => {
    const frame = new FakeFrame();
    const channel = newChannel(
      registryWith([{ appletId: APPLET_ID, subType: 'main', source: frame }]),
    );
    const waiting = channel.waitForReadyAppletFrame(APPLET_ID, 'main', 1000);
    await sendRequest(channel, echoType, frame, { type: 'ready' });
    expect(await waiting).toBe(frame);
  });

  it('resolves at once when the view is already ready', async () => {
    const frame = new FakeFrame();
    const channel = newChannel(
      registryWith([{ appletId: APPLET_ID, subType: 'main', source: frame }]),
    );
    channel.markReady(frame as unknown as MessageEventSource);
    expect(await channel.waitForReadyAppletFrame(APPLET_ID, 'main', 0)).toBe(frame);
  });

  it('does not satisfy a wait for one applet with another applet becoming ready', async () => {
    vi.useFakeTimers();
    const other = new FakeFrame();
    const channel = newChannel(
      registryWith([{ appletId: 'other', subType: 'main', source: other }]),
    );
    const waiting = channel.waitForReadyAppletFrame(APPLET_ID, 'main', 1000);
    channel.markReady(other as unknown as MessageEventSource);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await waiting).toBeUndefined();
  });

  it('does not satisfy a wait for the main view with a ready asset view', async () => {
    vi.useFakeTimers();
    const asset = new FakeFrame();
    const channel = newChannel(
      registryWith([{ appletId: APPLET_ID, subType: 'asset', source: asset }]),
    );
    const waiting = channel.waitForReadyAppletFrame(APPLET_ID, 'main', 1000);
    channel.markReady(asset as unknown as MessageEventSource);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await waiting).toBeUndefined();
  });

  it('forgets a frame when it unregisters, and still passes the request to the handler', async () => {
    const frame = new FakeFrame();
    const channel = newChannel();
    const handle = vi.fn(echoType);
    await sendRequest(channel, handle, frame, { type: 'ready' });
    await sendRequest(channel, handle, frame, { type: 'unregister-iframe', id: 'i1' });
    expect(channel.isReady(frame as unknown as MessageEventSource)).toBe(false);
    expect(handle).toHaveBeenCalledTimes(1);
  });
});

describe('AppletChannel: broadcasts', () => {
  const locale: ParentToAppletMessage = { type: 'locale-change', locale: 'de' };

  it('posts at once to a ready frame', () => {
    const frame = new FakeFrame();
    const channel = newChannel(
      registryWith([{ appletId: APPLET_ID, subType: 'main', source: frame }]),
    );
    channel.markReady(frame as unknown as MessageEventSource);
    channel.broadcast('all', locale);
    expect(frame.posted).toEqual([locale]);
  });

  it('holds messages for a frame that is not ready and sends them in order when it reports ready', () => {
    const frame = new FakeFrame();
    const channel = newChannel(
      registryWith([{ appletId: APPLET_ID, subType: 'main', source: frame }]),
    );
    const signal1: ParentToAppletMessage = {
      type: 'remote-signal-received',
      payload: new Uint8Array([1]),
    } as ParentToAppletMessage;
    const signal2: ParentToAppletMessage = {
      type: 'remote-signal-received',
      payload: new Uint8Array([2]),
    } as ParentToAppletMessage;
    channel.broadcast([APPLET_ID], signal1);
    channel.broadcast([APPLET_ID], signal2);
    expect(frame.posted).toEqual([]);
    channel.markReady(frame as unknown as MessageEventSource);
    expect(frame.posted).toEqual([signal1, signal2]);
  });

  it('does not hold messages for a frame whose window was closed', () => {
    const removed = new CrossOriginFrame();
    removed.closed = true;
    const channel = newChannel(
      registryWith([{ appletId: APPLET_ID, subType: 'main', source: removed }]),
    );
    channel.broadcast('all', locale);
    channel.markReady(removed as unknown as MessageEventSource);
    expect(removed.posted).toEqual([]);
  });

  it('drops the oldest held message past the cap', () => {
    const frame = new FakeFrame();
    const channel = new AppletChannel({
      registry: registryWith([{ appletId: APPLET_ID, subType: 'main', source: frame }]),
      isAppletDev: () => false,
      queueCap: 2,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    channel.broadcast('all', { type: 'locale-change', locale: 'a' });
    channel.broadcast('all', { type: 'locale-change', locale: 'b' });
    channel.broadcast('all', { type: 'locale-change', locale: 'c' });
    channel.markReady(frame as unknown as MessageEventSource);
    expect(frame.posted.map((m) => (m as { locale: string }).locale)).toEqual(['b', 'c']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('sends only to frames of the listed applets and skips frames that live in a WAL window', () => {
    const mine = new FakeFrame();
    const other = new FakeFrame();
    const registry = registryWith([
      { appletId: APPLET_ID, subType: 'main', source: mine },
      { appletId: 'other', subType: 'main', source: other },
      { appletId: APPLET_ID, subType: 'asset', source: 'wal-window' },
    ]);
    const channel = newChannel(registry);
    channel.markReady(mine as unknown as MessageEventSource);
    channel.markReady(other as unknown as MessageEventSource);
    channel.broadcast([APPLET_ID], locale);
    expect(mine.posted).toEqual([locale]);
    expect(other.posted).toEqual([]);
  });
});

describe('AppletChannel: requests to frames', () => {
  it('resolves with the frame reply', async () => {
    const frame = new FakeFrame();
    frame.answer = (_m, port) => port.postMessage({ type: 'success', result: 42 });
    const channel = newChannel();
    expect(
      await channel.request(
        frame as unknown as MessageEventSource,
        {
          type: 'search',
          filter: 'x',
        },
        { appletId: APPLET_ID },
      ),
    ).toBe(42);
  });

  it('rejects with the frame error', async () => {
    const frame = new FakeFrame();
    frame.answer = (_m, port) => port.postMessage({ type: 'error', error: 'boom' });
    const channel = newChannel();
    await expect(
      channel.request(
        frame as unknown as MessageEventSource,
        { type: 'search', filter: 'x' },
        { appletId: APPLET_ID },
      ),
    ).rejects.toThrow('boom');
  });

  it('times out and says the frame never reported ready when it did not', async () => {
    const channel = newChannel();
    await expect(
      channel.request(
        new FakeFrame() as unknown as MessageEventSource,
        {
          type: 'search',
          filter: 'x',
        },
        { appletId: APPLET_ID },
      ),
    ).rejects.toThrow('never reported that it was ready');
  });

  it('times out and points at the Tool handler when the frame reported ready', async () => {
    const frame = new FakeFrame();
    const channel = newChannel();
    channel.markReady(frame as unknown as MessageEventSource);
    await expect(
      channel.request(
        frame as unknown as MessageEventSource,
        { type: 'search', filter: 'x' },
        { appletId: APPLET_ID },
      ),
    ).rejects.toThrow("stalled inside the Tool's own handler");
  });

  it('rejects on timeout for a cross-origin frame, naming the applet', async () => {
    const channel = newChannel();
    await expect(
      channel.request(
        new CrossOriginFrame() as unknown as MessageEventSource,
        { type: 'search', filter: 'x' },
        { appletId: APPLET_ID },
      ),
    ).rejects.toThrow(`to applet ${APPLET_ID} timed out`);
  });

  it('finishes waiting for all frames when a ready cross-origin frame never answers', async () => {
    const silent = new CrossOriginFrame();
    const channel = newChannel(
      registryWith([{ appletId: APPLET_ID, subType: 'main', source: silent }]),
    );
    channel.markReady(silent as unknown as MessageEventSource);
    await expect(
      channel.requestAll('all', { type: 'on-before-unload' }, 20),
    ).resolves.toBeUndefined();
  });

  it('skips and forgets a ready frame whose window was closed, without waiting for it', async () => {
    const removed = new CrossOriginFrame();
    const channel = newChannel(
      registryWith([{ appletId: APPLET_ID, subType: 'main', source: removed }]),
    );
    channel.markReady(removed as unknown as MessageEventSource);
    removed.closed = true;
    const started = Date.now();
    await channel.requestAll('all', { type: 'on-before-unload' }, 1000);
    expect(Date.now() - started).toBeLessThan(500);
    expect(removed.posted).toEqual([]);
    expect(channel.isReady(removed as unknown as MessageEventSource)).toBe(false);
  });

  it('waits for every ready frame to answer, and skips frames that are not ready', async () => {
    const ready = new FakeFrame();
    const notReady = new FakeFrame();
    let answered = false;
    ready.answer = (_m, port) =>
      setTimeout(() => {
        answered = true;
        port.postMessage({ type: 'success', result: 1 });
      }, 10);
    const channel = newChannel(
      registryWith([
        { appletId: APPLET_ID, subType: 'main', source: ready },
        { appletId: 'other', subType: 'main', source: notReady },
      ]),
    );
    channel.markReady(ready as unknown as MessageEventSource);
    await channel.requestAll('all', { type: 'on-before-unload' }, 1000);
    expect(answered).toBe(true);
    expect(notReady.posted).toEqual([]);
  });
});

// Keeps the request fixture typed against the protocol.
export const _typed: AppletToParentRequest = { type: 'user-select-screen' };

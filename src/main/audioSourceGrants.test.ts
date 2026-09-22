import { describe, it, expect, vi } from 'vitest';
import type { JsAudioChunk, JsProcessInfo, JsStreamEvent, OpenOptions } from '@lightningrodlabs/flexaudio';
import type { AudioSourceRow } from '@theweave/moss-types';
import type { AudioCaptureBackend } from './audioCapture';
import {
  AudioSourceGrants,
  AudioSourceGrantsBindings,
  GrantPort,
  buildAudioSourceRows,
  describeSelection,
} from './audioSourceGrants';
import { FRAME_SAMPLES } from './audioMixer';

// ---------- fakes ----------

type OpenedStream = {
  options: OpenOptions;
  onChunk: (c: JsAudioChunk) => void;
  onEvent?: (e: JsStreamEvent) => void;
  stop: ReturnType<typeof vi.fn>;
};

class FakeBackend implements AudioCaptureBackend {
  opened: OpenedStream[] = [];
  processList: JsProcessInfo[] = [];
  devicesThrows = false;
  processesRejects = false;
  /** When set, openStream throws for options matching the predicate. */
  failOpen: (o: OpenOptions) => boolean = () => false;

  devices() {
    if (this.devicesThrows) throw new Error('no session');
    return [];
  }
  async processes() {
    if (this.processesRejects) throw new Error('unsupported');
    return this.processList;
  }
  openStream(options: OpenOptions, onChunk: (c: JsAudioChunk) => void, onEvent?: (e: JsStreamEvent) => void) {
    if (this.failOpen(options)) throw new Error(`cannot open ${options.kind}`);
    const stop = vi.fn(async () => {});
    const s: OpenedStream = { options, onChunk, onEvent, stop };
    this.opened.push(s);
    return { stop } as unknown as ReturnType<AudioCaptureBackend['openStream']>;
  }
  chunk(i: number, value: number, frames = FRAME_SAMPLES) {
    this.opened[i].onChunk({
      data: new Float32Array(frames).fill(value),
      frames,
      ptsNs: 0,
      seq: 0n,
      flags: 0,
      droppedBefore: 0,
      peak: value,
      rms: value,
    });
  }
  event(i: number, ev: JsStreamEvent) {
    this.opened[i].onEvent?.(ev);
  }
}

class FakePort implements GrantPort {
  sent: unknown[] = [];
  closed = false;
  started = false;
  private listeners: Array<(e: { data: unknown }) => void> = [];
  postMessage(data: unknown) {
    if (this.closed) throw new Error('port closed');
    this.sent.push(data);
  }
  on(_event: 'message', l: (e: { data: unknown }) => void) {
    this.listeners.push(l);
  }
  start() {
    this.started = true;
  }
  close() {
    this.closed = true;
  }
  /** The Tool's end of the channel speaking. */
  receive(data: unknown) {
    this.listeners.forEach((l) => l({ data }));
  }
}

class FakeScheduler {
  private fns = new Map<number, () => void>();
  private next = 1;
  setInterval(fn: () => void, _ms: number) {
    const h = this.next++;
    this.fns.set(h, fn);
    return h;
  }
  clearInterval(h: unknown) {
    this.fns.delete(h as number);
  }
  tick() {
    for (const fn of this.fns.values()) fn();
  }
  get active() {
    return this.fns.size;
  }
}

function rig(overrides: Partial<AudioSourceGrantsBindings> = {}) {
  const backend = new FakeBackend();
  const scheduler = new FakeScheduler();
  const ports: FakePort[] = [];
  const delivered: Array<{ targetId: number; requestId: string; grantId: string }> = [];
  const changes: number[] = [];
  let ids = 0;
  const picker = vi.fn(async (_rows: AudioSourceRow[]): Promise<string[] | null> => ['system']);
  const bindings: AudioSourceGrantsBindings = {
    backend: () => backend,
    platform: 'linux',
    picker,
    excludePids: () => [100, 101],
    openChannel: () => {
      const port1 = new FakePort();
      ports.push(port1);
      return { port1, port2: { tag: 'port2' } };
    },
    deliverPort: (targetId, payload, _port2) => {
      delivered.push({ targetId, ...payload });
      return true;
    },
    scheduler,
    now: () => 1_000,
    newId: () => `g${++ids}`,
    onGrantsChanged: (list) => changes.push(list.length),
    ...overrides,
  };
  const grants = new AudioSourceGrants(bindings);
  return { grants, backend, scheduler, ports, delivered, changes, picker };
}

const REQ = { requestId: 'r1', toolName: 'Presence', targetId: 7 };
/** Lets every pending microtask and the stop()/endGrant chains settle. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------- pure helpers ----------

describe('buildAudioSourceRows', () => {
  const procs: JsProcessInfo[] = [
    { pid: 5, name: 'Zoom', isOutputActive: false },
    { pid: 3, name: 'Firefox', isOutputActive: true },
    { pid: 100, name: 'moss', isOutputActive: true },
    { pid: 9, name: 'Alpha' },
    { pid: 4, name: 'Spotify', isOutputActive: true },
  ];

  it('system row first, then playing → silent → unknown, each by name; Moss tree filtered', () => {
    const { rows, pidById } = buildAudioSourceRows(procs, [100, 101]);
    expect(rows.map((r) => r.name)).toEqual([
      'All system output (except Moss)',
      'Firefox',
      'Spotify',
      'Zoom',
      'Alpha',
    ]);
    expect(rows[0]).toEqual({ id: 'system', kind: 'system', name: 'All system output (except Moss)', playing: null });
    expect(rows[1].playing).toBe(true);
    expect(rows[3].playing).toBe(false);
    expect(rows[4].playing).toBeNull();
    expect(pidById.get(rows[1].id)).toBe(3);
    expect([...pidById.values()]).not.toContain(100);
  });

  it('row ids are opaque, never the pid', () => {
    const { rows } = buildAudioSourceRows(procs, []);
    for (const r of rows.filter((r) => r.kind === 'app')) expect(r.id).not.toMatch(/^\d+$/);
  });
});

describe('describeSelection', () => {
  it.each([
    [true, [], 'System audio'],
    [false, ['Spotify'], 'Spotify'],
    [false, ['Spotify', 'Firefox'], 'Spotify, Firefox'],
    [true, ['Spotify'], 'System audio, Spotify'],
  ])('system=%s apps=%j → %s', (system, apps, expected) => {
    expect(describeSelection(system, apps)).toBe(expected);
  });
});

// ---------- request table ----------

describe('AudioSourceGrants.request', () => {
  it('no addon → null, picker never opened', async () => {
    const r = rig({ backend: () => undefined });
    expect(await r.grants.request(REQ)).toBeNull();
    expect(r.picker).not.toHaveBeenCalled();
  });

  it('devices() throws → null', async () => {
    const r = rig();
    r.backend.devicesThrows = true;
    expect(await r.grants.request(REQ)).toBeNull();
    expect(r.picker).not.toHaveBeenCalled();
  });

  it('picker cancelled → null, nothing opened', async () => {
    const r = rig();
    r.picker.mockResolvedValueOnce(null);
    expect(await r.grants.request(REQ)).toBeNull();
    expect(r.backend.opened).toEqual([]);
    expect(r.grants.list()).toEqual([]);
  });

  it('picker confirms nothing → null', async () => {
    const r = rig();
    r.picker.mockResolvedValueOnce([]);
    expect(await r.grants.request(REQ)).toBeNull();
  });

  it('processes() rejects → picker gets only the system row', async () => {
    const r = rig();
    r.backend.processesRejects = true;
    await r.grants.request(REQ);
    const rows = r.picker.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('system');
  });

  it('system row chosen → one system stream with excludeSelf + the process tree, fixed format', async () => {
    const r = rig();
    const result = await r.grants.request(REQ);
    expect(result).toEqual({ grantId: 'g1', label: 'System audio', canExcludeSelf: true });
    expect(r.backend.opened).toHaveLength(1);
    expect(r.backend.opened[0].options).toEqual({
      kind: 'system',
      excludeSelf: true,
      excludePids: [100, 101],
      outputRate: 48000,
      outputChannels: 1,
      chunkMs: 20,
    });
    expect(r.delivered).toEqual([{ targetId: 7, requestId: 'r1', grantId: 'g1' }]);
    expect(r.ports[0].started).toBe(true);
    expect(r.grants.list()).toMatchObject([{ grantId: 'g1', toolName: 'Presence', label: 'System audio', startedAt: 1_000 }]);
    expect(r.changes).toEqual([1]);
  });

  it('two apps chosen → one process stream each, label from names', async () => {
    const r = rig();
    r.backend.processList = [
      { pid: 3, name: 'Firefox', isOutputActive: true },
      { pid: 4, name: 'Spotify', isOutputActive: true },
    ];
    r.picker.mockImplementationOnce(async (rows) => rows.filter((x) => x.kind === 'app').map((x) => x.id));
    const result = await r.grants.request(REQ);
    expect(result?.label).toBe('Firefox, Spotify');
    expect(r.backend.opened.map((s) => s.options)).toEqual([
      { kind: 'process', processId: 3, outputRate: 48000, outputChannels: 1, chunkMs: 20 },
      { kind: 'process', processId: 4, outputRate: 48000, outputChannels: 1, chunkMs: 20 },
    ]);
  });

  it('one of two apps fails to open → the other is captured (Review Focus 3)', async () => {
    const r = rig();
    r.backend.processList = [
      { pid: 3, name: 'Firefox', isOutputActive: true },
      { pid: 4, name: 'Spotify', isOutputActive: true },
    ];
    r.backend.failOpen = (o) => o.processId === 3;
    r.picker.mockImplementationOnce(async (rows) => rows.filter((x) => x.kind === 'app').map((x) => x.id));
    const result = await r.grants.request(REQ);
    expect(result?.label).toBe('Spotify');
    expect(r.backend.opened).toHaveLength(1);
  });

  it('nothing opens → rejects and leaves no grant', async () => {
    const r = rig();
    r.backend.failOpen = () => true;
    await expect(r.grants.request(REQ)).rejects.toThrow(/Failed to open audio capture/);
    expect(r.grants.list()).toEqual([]);
    expect(r.ports[0]?.closed ?? true).toBe(true);
  });

  it('a second request while the picker is open rejects', async () => {
    const r = rig();
    let release!: (v: string[] | null) => void;
    r.picker.mockImplementationOnce(() => new Promise<string[] | null>((res) => (release = res)));
    const first = r.grants.request(REQ);
    await flush();
    await expect(r.grants.request({ ...REQ, requestId: 'r2' })).rejects.toThrow(/one audio source picker/);
    release(null);
    expect(await first).toBeNull();
  });

  it('requesting window gone at delivery → grant ended, streams stopped, null (Review Focus 2)', async () => {
    const r = rig({ deliverPort: () => false });
    expect(await r.grants.request(REQ)).toBeNull();
    expect(r.backend.opened[0].stop).toHaveBeenCalledTimes(1);
    expect(r.ports[0].closed).toBe(true);
    expect(r.grants.list()).toEqual([]);
  });
});

// ---------- the pump ----------

describe('frame pump', () => {
  it('each tick posts one 960-sample Int16 frame mixing one chunk per stream', async () => {
    const r = rig();
    r.backend.processList = [{ pid: 3, name: 'Firefox', isOutputActive: true }];
    r.picker.mockImplementationOnce(async (rows) => rows.map((x) => x.id));
    await r.grants.request(REQ);
    r.backend.chunk(0, 0.25);
    r.backend.chunk(1, 0.25);
    r.scheduler.tick();
    const frame = r.ports[0].sent[0] as Int16Array;
    expect(frame).toBeInstanceOf(Int16Array);
    expect(frame.length).toBe(FRAME_SAMPLES);
    expect(frame[0]).toBe(16384);
    expect(r.grants.list()[0].counters.framesSent).toBe(1);
  });

  it('no chunks queued → a silent frame still goes out', async () => {
    const r = rig();
    await r.grants.request(REQ);
    r.scheduler.tick();
    const frame = r.ports[0].sent[0] as Int16Array;
    expect(frame.every((s) => s === 0)).toBe(true);
  });

  it('the stop terminator (frames: 0) is not queued', async () => {
    const r = rig();
    await r.grants.request(REQ);
    r.backend.chunk(0, 0.5, 0);
    r.scheduler.tick();
    expect((r.ports[0].sent[0] as Int16Array)[0]).toBe(0);
  });

  it('backlog drops are counted', async () => {
    const r = rig();
    await r.grants.request(REQ);
    for (let i = 0; i < 8; i++) r.backend.chunk(0, 0.1);
    r.scheduler.tick();
    expect(r.grants.list()[0].counters.backlogDropped).toBe(3);
  });
});

// ---------- ending ----------

describe('ending a grant', () => {
  it('endGrant stops streams, posts ended, closes the port, clears the timer, notifies', async () => {
    const r = rig();
    await r.grants.request(REQ);
    await r.grants.endGrant('g1', 'user-stopped');
    expect(r.backend.opened[0].stop).toHaveBeenCalledTimes(1);
    expect(r.ports[0].sent.at(-1)).toEqual({ type: 'ended', reason: 'user-stopped' });
    expect(r.ports[0].closed).toBe(true);
    expect(r.scheduler.active).toBe(0);
    expect(r.grants.list()).toEqual([]);
    expect(r.changes).toEqual([1, 0]);
  });

  it('endGrant twice: second call is a no-op and keeps the first reason (Review Focus 5)', async () => {
    const r = rig();
    await r.grants.request(REQ);
    await r.grants.endGrant('g1', 'user-stopped');
    await r.grants.endGrant('g1', 'tool-closed');
    expect(r.ports[0].sent.filter((m) => (m as { type?: string }).type === 'ended')).toEqual([
      { type: 'ended', reason: 'user-stopped' },
    ]);
    expect(r.backend.opened[0].stop).toHaveBeenCalledTimes(1);
    expect(r.changes).toEqual([1, 0]);
  });

  it('endGrant for an unknown id resolves without notifying', async () => {
    const r = rig();
    await r.grants.endGrant('nope', 'user-stopped');
    expect(r.changes).toEqual([]);
  });

  it("the Tool's {type:'close'} on the port ends the grant as tool-closed", async () => {
    const r = rig();
    await r.grants.request(REQ);
    r.ports[0].receive({ type: 'close' });
    await flush();
    expect(r.grants.list()).toEqual([]);
    expect(r.ports[0].sent.at(-1)).toEqual({ type: 'ended', reason: 'tool-closed' });
  });

  it('an unrelated port message is ignored', async () => {
    const r = rig();
    await r.grants.request(REQ);
    r.ports[0].receive({ type: 'hello' });
    r.ports[0].receive('garbage');
    await flush();
    expect(r.grants.list()).toHaveLength(1);
  });

  it('endGrantsForTarget ends only that window\'s grants', async () => {
    const r = rig();
    await r.grants.request(REQ);
    await r.grants.request({ requestId: 'r2', toolName: 'Other', targetId: 8 });
    await r.grants.endGrantsForTarget(7, 'window-closed');
    expect(r.grants.list().map((g) => g.grantId)).toEqual(['g2']);
  });
});

// ---------- stream events ----------

describe('stream events', () => {
  async function twoStreams() {
    const r = rig();
    r.backend.processList = [{ pid: 3, name: 'Firefox', isOutputActive: true }];
    r.picker.mockImplementationOnce(async (rows) => rows.map((x) => x.id));
    await r.grants.request(REQ);
    return r;
  }

  it('chunkDropped / stalled / recovered only count', async () => {
    const r = await twoStreams();
    r.backend.event(0, { type: 'chunkDropped', count: 4 });
    r.backend.event(0, { type: 'stalled' });
    r.backend.event(0, { type: 'recovered' });
    expect(r.grants.list()[0].counters).toMatchObject({ chunksDropped: 4, stalls: 1, recoveries: 1 });
    expect(r.grants.list()).toHaveLength(1);
  });

  it('deviceLost on one of two streams ends that stream only', async () => {
    const r = await twoStreams();
    r.backend.event(1, { type: 'deviceLost' });
    await flush();
    expect(r.backend.opened[1].stop).toHaveBeenCalledTimes(1);
    expect(r.backend.opened[0].stop).not.toHaveBeenCalled();
    expect(r.grants.list()).toHaveLength(1);
  });

  it('the last stream failing ends the grant with the mapped reason', async () => {
    const r = await twoStreams();
    r.backend.event(1, { type: 'deviceLost' });
    await flush();
    r.backend.event(0, { type: 'error', message: 'boom' });
    await flush();
    expect(r.grants.list()).toEqual([]);
    expect(r.ports[0].sent.at(-1)).toEqual({ type: 'ended', reason: 'stream-error' });
  });

  it.each([
    ['deviceLost', 'process', 'app-quit'],
    ['deviceLost', 'system', 'stream-lost'],
    ['permissionDenied', 'system', 'permission-denied'],
    ['error', 'system', 'stream-error'],
  ] as const)('%s on a %s stream → %s', async (type, kind, reason) => {
    const r = rig();
    if (kind === 'process') {
      r.backend.processList = [{ pid: 3, name: 'Firefox' }];
      r.picker.mockImplementationOnce(async (rows) => rows.filter((x) => x.kind === 'app').map((x) => x.id));
    }
    await r.grants.request(REQ);
    r.backend.event(0, { type });
    await flush();
    expect(r.ports[0].sent.at(-1)).toEqual({ type: 'ended', reason });
  });
});

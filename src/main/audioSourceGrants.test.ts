import { describe, it, expect, vi } from 'vitest';
import type {
  JsAudioChunk,
  JsProcessInfo,
  JsStreamEvent,
  OpenOptions,
} from '@lightningrodlabs/flexaudio';
import type { AudioSourceRow } from '@theweave/moss-types';
import type { AudioCaptureBackend } from './audioCapture';
import type { PickerRequester } from './audioSourceGrants';
import {
  AudioSourceGrants,
  AudioSourceGrantsBindings,
  GrantPort,
  buildAudioSourceRows,
  describeSelection,
} from './audioSourceGrants';
import {
  FRAME_MS,
  FRAME_SAMPLES,
  MAX_CATCHUP_FRAMES,
  PUMP_MAX_FRAMES_PER_TICK,
} from './audioMixer';

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
  /** How often the process list has been enumerated. */
  processesCalls = 0;
  /** When set, openStream throws for options matching the predicate. */
  failOpen: (o: OpenOptions) => boolean = () => false;
  /** Per-call: when it returns an event, openStream fires it synchronously before returning the handle. */
  emitOnOpen: (options: OpenOptions) => JsStreamEvent | undefined = () => undefined;

  devices() {
    if (this.devicesThrows) throw new Error('no session');
    return [];
  }
  async processes() {
    this.processesCalls += 1;
    if (this.processesRejects) throw new Error('unsupported');
    return this.processList;
  }
  openStream(
    options: OpenOptions,
    onChunk: (c: JsAudioChunk) => void,
    onEvent?: (e: JsStreamEvent) => void,
  ) {
    if (this.failOpen(options)) throw new Error(`cannot open ${options.kind}`);
    const stop = vi.fn(async () => {});
    const s: OpenedStream = { options, onChunk, onEvent, stop };
    this.opened.push(s);
    const ev = this.emitOnOpen(options);
    if (ev) onEvent?.(ev);
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
  private messageListeners: Array<(e: { data: unknown }) => void> = [];
  private closeListeners: Array<() => void> = [];
  postMessage(data: unknown) {
    if (this.closed) throw new Error('port closed');
    this.sent.push(data);
  }
  on(event: 'message', l: (e: { data: unknown }) => void): void;
  on(event: 'close', l: () => void): void;
  on(event: 'message' | 'close', l: ((e: { data: unknown }) => void) | (() => void)) {
    if (event === 'message') this.messageListeners.push(l as (e: { data: unknown }) => void);
    else this.closeListeners.push(l as () => void);
  }
  start() {
    this.started = true;
  }
  close() {
    this.closed = true;
  }
  /** The Tool's end of the channel speaking. */
  receive(data: unknown) {
    this.messageListeners.forEach((l) => l({ data }));
  }
  /** Electron's `MessagePortMain` 'close' event: the remote end disconnected. */
  remoteClose() {
    this.closeListeners.forEach((l) => l());
  }
}

class FakeScheduler {
  private fns = new Map<number, () => void>();
  private next = 1;
  /**
   * The rig's clock. The pump emits by elapsed wall time, so a tick that does
   * not move this forward is a tick that is not due — `tickWithoutTime()`.
   */
  now = 1_000;
  setInterval(fn: () => void, _ms: number) {
    const h = this.next++;
    this.fns.set(h, fn);
    return h;
  }
  clearInterval(h: unknown) {
    this.fns.delete(h as number);
  }
  /** Advances the clock by `ms` (one frame by default), then runs the timers. */
  tick(ms: number = FRAME_MS) {
    this.now += ms;
    for (const fn of this.fns.values()) fn();
  }
  /** Runs the timers without moving the clock. */
  tickWithoutTime() {
    this.tick(0);
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
  const picker = vi.fn(
    async (_rows: AudioSourceRow[], _requester: PickerRequester): Promise<string[] | null> => [
      'system',
    ],
  );
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
    now: () => scheduler.now,
    monotonicNow: () => scheduler.now,
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
    expect(rows[0]).toEqual({
      id: 'system',
      kind: 'system',
      name: 'All system output (except Moss)',
      playing: null,
    });
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

  it('system services that never play user audio are not offered', () => {
    const { rows, pidById } = buildAudioSourceRows(
      [
        { pid: 7, name: 'speech-dispatcher-dummy', isOutputActive: false },
        { pid: 8, name: 'speech-dispatcher-espeak-ng', isOutputActive: false },
        { pid: 3, name: 'Firefox', isOutputActive: true },
      ],
      [],
    );
    expect(rows.map((r) => r.name)).toEqual(['All system output (except Moss)', 'Firefox']);
    expect([...pidById.values()]).toEqual([3]);
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

  it('the picker is told which window and Tool are asking', async () => {
    const r = rig();
    await r.grants.request(REQ);
    expect(r.picker.mock.calls[0][1]).toEqual({ targetId: 7, toolName: 'Presence' });
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
    expect(r.grants.list()).toMatchObject([
      { grantId: 'g1', toolName: 'Presence', label: 'System audio', startedAt: 1_000 },
    ]);
    expect(r.changes).toEqual([1]);
  });

  it('two apps chosen → one process stream each, label from names', async () => {
    const r = rig();
    r.backend.processList = [
      { pid: 3, name: 'Firefox', isOutputActive: true },
      { pid: 4, name: 'Spotify', isOutputActive: true },
    ];
    r.picker.mockImplementationOnce(async (rows) =>
      rows.filter((x) => x.kind === 'app').map((x) => x.id),
    );
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
    r.picker.mockImplementationOnce(async (rows) =>
      rows.filter((x) => x.kind === 'app').map((x) => x.id),
    );
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

  it('the sole stream dying via a synchronous fatal event during open rejects like any other open failure', async () => {
    const r = rig();
    r.backend.emitOnOpen = () => ({ type: 'error', message: 'open failed' });
    await expect(r.grants.request(REQ)).rejects.toThrow(/Failed to open audio capture/);
    expect(r.grants.list()).toEqual([]);
    expect(r.backend.opened[0].stop).toHaveBeenCalledTimes(1);
    expect(r.ports[0].closed).toBe(true);
    expect(r.ports[0].sent.some((m) => (m as { type?: string }).type === 'ended')).toBe(false);
  });

  it('one stream dying via a synchronous fatal event during open does not strand the grant or leak the timer when a later row succeeds', async () => {
    const r = rig();
    r.backend.processList = [
      { pid: 3, name: 'Firefox', isOutputActive: true },
      { pid: 4, name: 'Spotify', isOutputActive: true },
    ];
    r.backend.emitOnOpen = (o) =>
      o.processId === 3 ? { type: 'error', message: 'open failed' } : undefined;
    r.picker.mockImplementationOnce(async (rows) =>
      rows.filter((x) => x.kind === 'app').map((x) => x.id),
    );
    const result = await r.grants.request(REQ);
    expect(result?.label).toBe('Spotify');
    expect(r.backend.opened).toHaveLength(2);
    expect(r.backend.opened[0].stop).toHaveBeenCalledTimes(1);
    expect(r.backend.opened[1].stop).not.toHaveBeenCalled();
    expect(r.grants.list()).toHaveLength(1);
    expect(r.scheduler.active).toBe(1);
    r.scheduler.tick();
    expect(r.ports[0].sent.at(-1)).toBeInstanceOf(Int16Array);
  });

  it('a second request while the picker is open rejects', async () => {
    const r = rig();
    let release!: (v: string[] | null) => void;
    r.picker.mockImplementationOnce(() => new Promise<string[] | null>((res) => (release = res)));
    const first = r.grants.request(REQ);
    await flush();
    await expect(r.grants.request({ ...REQ, requestId: 'r2' })).rejects.toThrow(
      /one audio source picker/,
    );
    release(null);
    expect(await first).toBeNull();
  });

  it('enumerates the process list exactly once per request', async () => {
    const r = rig();
    r.backend.processList = [{ pid: 3, name: 'Firefox', isOutputActive: true }];
    await r.grants.request(REQ);
    expect(r.backend.processesCalls).toBe(1);
  });

  it("a dead stream's id is never reused, so a late event cannot tear down its successor", async () => {
    const r = rig();
    r.backend.processList = [
      { pid: 3, name: 'Firefox', isOutputActive: true },
      { pid: 4, name: 'Spotify', isOutputActive: true },
    ];
    // The first row dies inside openStream; the second opens normally.
    r.backend.emitOnOpen = (o) =>
      o.processId === 3 ? { type: 'error', message: 'open failed' } : undefined;
    r.picker.mockImplementationOnce(async (rows) =>
      rows.filter((x) => x.kind === 'app').map((x) => x.id),
    );
    const result = await r.grants.request(REQ);
    expect(result?.label).toBe('Spotify');
    // The addon keeps the dead stream's callbacks and fires a late deviceLost.
    r.backend.event(0, { type: 'deviceLost' });
    await flush();
    expect(r.grants.list()).toHaveLength(1);
    expect(r.backend.opened[1].stop).not.toHaveBeenCalled();
    r.scheduler.tick();
    expect(r.ports[0].sent.at(-1)).toBeInstanceOf(Int16Array);
  });

  it('a late deviceLost for a live stream still ends the grant (negative control)', async () => {
    const r = rig();
    r.backend.processList = [{ pid: 4, name: 'Spotify', isOutputActive: true }];
    r.picker.mockImplementationOnce(async (rows) =>
      rows.filter((x) => x.kind === 'app').map((x) => x.id),
    );
    await r.grants.request(REQ);
    r.backend.event(0, { type: 'deviceLost' });
    await flush();
    expect(r.grants.list()).toEqual([]);
    expect(r.backend.opened[0].stop).toHaveBeenCalledTimes(1);
    expect(r.ports[0].sent.at(-1)).toEqual({ type: 'ended', reason: 'app-quit' });
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

  it('no chunks queued → exactly one silent frame goes out (unchanged behaviour)', async () => {
    const r = rig();
    await r.grants.request(REQ);
    r.scheduler.tick();
    expect(r.ports[0].sent).toHaveLength(1);
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

  it('a backlog drains one frame per elapsed frame time, not one extra per tick', async () => {
    const r = rig();
    await r.grants.request(REQ);
    r.backend.chunk(0, 0.1);
    r.backend.chunk(0, 0.1);
    r.backend.chunk(0, 0.1);
    // A backlog is no licence to run fast: 20 ms elapsed buys exactly one frame.
    r.scheduler.tick();
    expect(r.ports[0].sent).toHaveLength(1);
    expect(r.grants.list()[0].counters.backlogDropped).toBe(0);
    expect(r.grants.list()[0].counters.framesSent).toBe(1);
    // Two frames' worth of time in one tick drains two, capped by
    // PUMP_MAX_FRAMES_PER_TICK.
    expect(PUMP_MAX_FRAMES_PER_TICK).toBe(2);
    r.scheduler.tick(2 * FRAME_MS);
    expect(r.ports[0].sent).toHaveLength(3);
    expect(r.grants.list()[0].counters.backlogDropped).toBe(0);
  });

  it("two streams with an uneven backlog: the leading frame mixes both, the extra carries only the deeper stream's leftover", async () => {
    const r = rig();
    r.backend.processList = [{ pid: 3, name: 'Firefox', isOutputActive: true }];
    r.picker.mockImplementationOnce(async (rows) => rows.map((x) => x.id));
    await r.grants.request(REQ);
    r.backend.chunk(0, 0.25);
    r.backend.chunk(0, 0.25);
    r.backend.chunk(1, 0.5);
    r.scheduler.tick();
    expect(r.ports[0].sent).toHaveLength(1);
    expect((r.ports[0].sent[0] as Int16Array)[0]).toBe(24575);
    // The deeper stream's leftover rides the next frame time, alone.
    r.scheduler.tick();
    expect(r.ports[0].sent).toHaveLength(2);
    expect((r.ports[0].sent[1] as Int16Array)[0]).toBe(8192);
  });

  // ---------- the frame clock ----------

  it('a tick that does not advance the clock posts nothing', async () => {
    const r = rig();
    await r.grants.request(REQ);
    r.backend.chunk(0, 0.5);
    r.scheduler.tickWithoutTime();
    expect(r.ports[0].sent).toHaveLength(0);
    expect(r.grants.list()[0].counters.framesSent).toBe(0);
  });

  it('two frame times elapsed inside one tick post exactly two frames', async () => {
    const r = rig();
    await r.grants.request(REQ);
    r.scheduler.tick(2 * FRAME_MS);
    expect(r.ports[0].sent).toHaveLength(2);
    expect(r.grants.list()[0].counters.framesSent).toBe(2);
  });

  it('a long stall is paid back at PUMP_MAX_FRAMES_PER_TICK per tick and then stops exactly on the debt', async () => {
    const r = rig();
    await r.grants.request(REQ);
    // 100 ms with a single tick: five frames are due, two may go now.
    r.scheduler.tick(5 * FRAME_MS);
    expect(r.ports[0].sent).toHaveLength(2);
    // Catch-up continues on ticks that add no time of their own, until the
    // debt is paid — then nothing more goes out.
    r.scheduler.tickWithoutTime();
    expect(r.ports[0].sent).toHaveLength(4);
    r.scheduler.tickWithoutTime();
    expect(r.ports[0].sent).toHaveLength(5);
    r.scheduler.tickWithoutTime();
    expect(r.ports[0].sent).toHaveLength(5);
    expect(r.grants.list()[0].counters.framesSent).toBe(5);
  });

  it('a multi-second stall is not replayed: catch-up is capped at MAX_CATCHUP_FRAMES', async () => {
    const r = rig();
    await r.grants.request(REQ);
    // 2 s of starved event loop: 100 frames' worth of time, 5 frames of debt.
    expect(MAX_CATCHUP_FRAMES).toBe(5);
    r.scheduler.tick(2_000);
    expect(r.ports[0].sent).toHaveLength(2);
    r.scheduler.tickWithoutTime();
    expect(r.ports[0].sent).toHaveLength(4);
    r.scheduler.tickWithoutTime();
    expect(r.ports[0].sent).toHaveLength(5);
    r.scheduler.tickWithoutTime();
    expect(r.ports[0].sent).toHaveLength(5);
    expect(r.grants.list()[0].counters.framesSent).toBe(5);
  });

  it('after a capped stall the ledger is back in step: the next frame time posts exactly one', async () => {
    const r = rig();
    await r.grants.request(REQ);
    r.scheduler.tick(2_000);
    r.scheduler.tickWithoutTime();
    r.scheduler.tickWithoutTime();
    const afterCatchUp = r.ports[0].sent.length;
    expect(afterCatchUp).toBe(5);
    // No residual debt: one frame time buys one frame, not a replay burst.
    r.scheduler.tick();
    expect(r.ports[0].sent).toHaveLength(afterCatchUp + 1);
    r.scheduler.tick();
    expect(r.ports[0].sent).toHaveLength(afterCatchUp + 2);
  });

  it('a wall-clock step backwards does not stall the wire', async () => {
    const monotonic = { now: 1_000 };
    const wall = { now: 50_000 };
    const r = rig({ now: () => wall.now, monotonicNow: () => monotonic.now });
    await r.grants.request(REQ);
    // Elapsed time keeps running while the wall clock is stepped back an hour.
    wall.now -= 3_600_000;
    for (let i = 0; i < 4; i++) {
      monotonic.now += FRAME_MS;
      r.scheduler.tickWithoutTime();
    }
    expect(r.ports[0].sent).toHaveLength(4);
    expect(r.grants.list()[0].counters.framesSent).toBe(4);
  });

  it('with nothing queued the wire still carries exactly one silent frame per frame time', async () => {
    const r = rig();
    await r.grants.request(REQ);
    for (let i = 0; i < 10; i++) r.scheduler.tick();
    expect(r.ports[0].sent).toHaveLength(10);
    expect((r.ports[0].sent as Int16Array[]).every((f) => f.every((x) => x === 0))).toBe(true);
    // 10 frame times elapsed, 10 frames sent: the rate the Tool's 48 kHz ring
    // drains at, no faster.
    expect(r.grants.list()[0].counters.framesSent).toBe(10);
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

  it('the remote end closing the port ends the grant as tool-closed', async () => {
    const r = rig();
    await r.grants.request(REQ);
    r.ports[0].remoteClose();
    await flush();
    expect(r.grants.list()).toEqual([]);
    expect(r.backend.opened[0].stop).toHaveBeenCalledTimes(1);
    expect(r.scheduler.active).toBe(0);
    expect(r.ports[0].sent.at(-1)).toEqual({ type: 'ended', reason: 'tool-closed' });
  });

  it('remoteClose on an already-ended grant is a no-op (negative control)', async () => {
    const r = rig();
    await r.grants.request(REQ);
    await r.grants.endGrant('g1', 'user-stopped');
    r.ports[0].remoteClose();
    await flush();
    expect(r.ports[0].sent.filter((m) => (m as { type?: string }).type === 'ended')).toEqual([
      { type: 'ended', reason: 'user-stopped' },
    ]);
    expect(r.backend.opened[0].stop).toHaveBeenCalledTimes(1);
  });

  it('an unrelated port message is ignored', async () => {
    const r = rig();
    await r.grants.request(REQ);
    r.ports[0].receive({ type: 'hello' });
    r.ports[0].receive('garbage');
    await flush();
    expect(r.grants.list()).toHaveLength(1);
  });

  it("endGrantsForTarget ends only that window's grants", async () => {
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
    expect(r.grants.list()[0].counters).toMatchObject({
      chunksDropped: 4,
      stalls: 1,
      recoveries: 1,
    });
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
      r.picker.mockImplementationOnce(async (rows) =>
        rows.filter((x) => x.kind === 'app').map((x) => x.id),
      );
    }
    await r.grants.request(REQ);
    r.backend.event(0, { type });
    await flush();
    expect(r.ports[0].sent.at(-1)).toEqual({ type: 'ended', reason });
  });
});

import type { JsAudioChunk, JsProcessInfo, JsStreamEvent, OpenOptions } from '@lightningrodlabs/flexaudio';
import type {
  AudioSourceEndReason,
  AudioSourceGrantCounters,
  AudioSourceGrantInfo,
  AudioSourcePortDelivery,
  AudioSourceRequestResult,
  AudioSourceRow,
} from '@theweave/moss-types';
import { AudioCaptureBackend, probeAudioCapabilities } from './audioCapture';
import {
  FRAME_MS,
  MAX_CATCHUP_FRAMES,
  PUMP_MAX_FRAMES_PER_TICK,
  mixToInt16,
  takeFrameInputs,
} from './audioMixer';

export const SYSTEM_ROW_ID = 'system';
export const SYSTEM_ROW_NAME = 'All system output (except Moss)';

/** The main-process end of a grant's MessageChannel (structurally `MessagePortMain`). */
export interface GrantPort {
  postMessage(data: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  /**
   * `MessagePortMain` emits this when the remote end disconnects (electron.d.ts,
   * `class MessagePortMain`: "Emitted when the remote end of a MessagePortMain
   * object becomes disconnected."), which is how a detached Tool iframe's port
   * is noticed: Chromium does not dispatch `beforeunload` for a detached
   * iframe, so the renderer's own `unregister-iframe` teardown message never
   * arrives.
   */
  on(event: 'close', listener: () => void): void;
  start(): void;
  close(): void;
}

export interface AudioSourceGrantsBindings {
  backend: () => AudioCaptureBackend | undefined;
  platform: NodeJS.Platform;
  /** Shows the picker; resolves the chosen row ids, or null on cancel/close. */
  picker: (rows: AudioSourceRow[]) => Promise<string[] | null>;
  /** Every pid in this app's process tree — the Chromium audio service, not `process.pid`, emits sound. */
  excludePids: () => number[];
  openChannel: () => { port1: GrantPort; port2: unknown };
  /** Hands `port2` to the requesting window; false when that window is gone. */
  deliverPort: (targetId: number, payload: AudioSourcePortDelivery, port2: unknown) => boolean;
  scheduler: {
    setInterval(fn: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
  };
  now: () => number;
  newId: () => string;
  onGrantsChanged: (grants: AudioSourceGrantInfo[]) => void;
}

export interface AudioSourceRequest {
  /** Renderer-chosen correlation id, echoed in the port delivery. */
  requestId: string;
  toolName: string;
  /** `webContents.id` of the requesting window. */
  targetId: number;
}

interface OpenStream {
  id: string;
  kind: 'system' | 'app';
  handle: { stop(): Promise<void> };
  queue: Float32Array[];
}

interface Grant {
  info: AudioSourceGrantInfo;
  targetId: number;
  port1: GrantPort;
  streams: Map<string, OpenStream>;
  timer: unknown;
  /** `now()` when the pump timer was armed; the origin of the frame clock. */
  pumpStartedAt: number;
  /** Frames this grant has put on the wire, counted against that clock. */
  framesEmitted: number;
  /**
   * True while `request` is still opening this grant's streams. A stream that
   * dies synchronously, mid-open, must not be allowed to end the grant on its
   * own just because it was briefly the only entry in `streams` — later rows
   * in the same request may still succeed. Cleared once the open loop is done
   * and the grant is either kept (streams > 0) or reported as failed.
   */
  opening: boolean;
}

const STREAM_FORMAT = { outputRate: 48000, outputChannels: 1, chunkMs: FRAME_MS } as const;

/**
 * Picker rows from the addon's process list: the all-output row first, then
 * apps with currently-playing ones ahead, silent next, unknown last, each group
 * by name. Processes in this app's own tree are not offered (they are excluded
 * from capture anyway). Row ids are positional and opaque; `pidById` is the
 * only place a pid is associated with a row and it never leaves main.
 */
export function buildAudioSourceRows(
  processes: JsProcessInfo[],
  excludePids: number[],
): { rows: AudioSourceRow[]; pidById: Map<string, number> } {
  const rank = (p: JsProcessInfo) => (p.isOutputActive === true ? 0 : p.isOutputActive === false ? 1 : 2);
  const excluded = new Set(excludePids);
  const apps = processes
    .filter((p) => !excluded.has(p.pid))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const pidById = new Map<string, number>();
  const rows: AudioSourceRow[] = [
    { id: SYSTEM_ROW_ID, kind: 'system', name: SYSTEM_ROW_NAME, playing: null },
  ];
  apps.forEach((p, i) => {
    const id = `app-${i}`;
    pidById.set(id, p.pid);
    rows.push({ id, kind: 'app', name: p.name, playing: p.isOutputActive ?? null });
  });
  return { rows, pidById };
}

export function describeSelection(system: boolean, appNames: string[]): string {
  const parts = system ? ['System audio', ...appNames] : appNames;
  return parts.join(', ');
}

function reasonForEvent(type: string, kind: 'system' | 'app'): AudioSourceEndReason | null {
  switch (type) {
    case 'deviceLost':
      return kind === 'app' ? 'app-quit' : 'stream-lost';
    case 'permissionDenied':
      return 'permission-denied';
    case 'error':
      return 'stream-error';
    default:
      return null;
  }
}

/**
 * Owns every active audio-source grant: the capture streams, the 20 ms mixer
 * pump and the main end of the port. Every way a grant can end funnels through
 * `endGrant`, which is idempotent.
 */
export class AudioSourceGrants {
  private grants = new Map<string, Grant>();
  private pickerOpen = false;

  constructor(private readonly b: AudioSourceGrantsBindings) {}

  list(): AudioSourceGrantInfo[] {
    return [...this.grants.values()].map((g) => ({
      ...g.info,
      counters: { ...g.info.counters },
    }));
  }

  async request(req: AudioSourceRequest): Promise<AudioSourceRequestResult | null> {
    const backend = this.b.backend();
    const caps = await probeAudioCapabilities(backend, this.b.platform);
    if (!backend || !caps.supported) return null;

    const excludePids = this.b.excludePids();
    const processes = caps.perApp ? await backend.processes().catch(() => [] as JsProcessInfo[]) : [];
    const { rows, pidById } = buildAudioSourceRows(processes, excludePids);

    if (this.pickerOpen) throw new Error('Only one audio source picker may be open at a time.');
    this.pickerOpen = true;
    let chosen: string[] | null;
    try {
      chosen = await this.b.picker(rows);
    } finally {
      this.pickerOpen = false;
    }
    if (!chosen || chosen.length === 0) return null;

    const chosenSet = new Set(chosen);
    const wantSystem = chosenSet.has(SYSTEM_ROW_ID);
    const wantApps = rows.filter((r) => r.kind === 'app' && chosenSet.has(r.id));
    if (!wantSystem && wantApps.length === 0) return null;

    const grantId = this.b.newId();
    const { port1, port2 } = this.b.openChannel();
    const grant: Grant = {
      info: {
        grantId,
        toolName: req.toolName,
        label: '',
        canExcludeSelf: caps.canExcludeSelf,
        startedAt: this.b.now(),
        counters: { chunksDropped: 0, backlogDropped: 0, stalls: 0, recoveries: 0, framesSent: 0 },
      },
      targetId: req.targetId,
      port1,
      streams: new Map(),
      timer: undefined,
      pumpStartedAt: 0,
      framesEmitted: 0,
      opening: true,
    };
    this.grants.set(grantId, grant);

    const openedNames: string[] = [];
    let openedSystem = false;
    if (wantSystem) {
      openedSystem = this.openStream(grant, backend, 'system', {
        kind: 'system',
        excludeSelf: true,
        excludePids,
        ...STREAM_FORMAT,
      });
    }
    for (const row of wantApps) {
      const pid = pidById.get(row.id);
      if (pid === undefined) continue;
      if (this.openStream(grant, backend, 'app', { kind: 'process', processId: pid, ...STREAM_FORMAT })) {
        openedNames.push(row.name);
      }
    }
    if (grant.streams.size === 0) {
      this.grants.delete(grantId);
      port1.close();
      throw new Error('Failed to open audio capture for the chosen sources.');
    }
    // Every row has now had its chance to open; a stream dying mid-open can
    // no longer end this grant behind the loop's back (see `opening` above).
    grant.opening = false;
    grant.info.label = describeSelection(openedSystem, openedNames);

    port1.on('message', (e) => {
      const data = e.data as { type?: unknown } | null | undefined;
      if (data && typeof data === 'object' && data.type === 'close') void this.endGrant(grantId, 'tool-closed');
    });
    // The Tool's own `{type: 'close'}` message covers a normal teardown, but a
    // detached iframe (Tool disabled/uninstalled, group left, view torn down)
    // never gets to send it — this is the backstop for that case.
    port1.on('close', () => void this.endGrant(grantId, 'tool-closed'));
    port1.start();
    grant.pumpStartedAt = this.b.now();
    grant.timer = this.b.scheduler.setInterval(() => this.pump(grant), FRAME_MS);

    if (!this.b.deliverPort(req.targetId, { requestId: req.requestId, grantId }, port2)) {
      await this.endGrant(grantId, 'window-closed');
      return null;
    }
    this.notify();
    return { grantId, label: grant.info.label, canExcludeSelf: caps.canExcludeSelf };
  }

  async endGrant(grantId: string, reason: AudioSourceEndReason): Promise<void> {
    const grant = this.grants.get(grantId);
    if (!grant) return;
    this.grants.delete(grantId);
    this.b.scheduler.clearInterval(grant.timer);
    const stops = [...grant.streams.values()].map((s) => s.handle.stop().catch(() => undefined));
    grant.streams.clear();
    try {
      grant.port1.postMessage({ type: 'ended', reason });
    } catch {
      // The port may already be closed by the other side; the grant still ends.
    }
    grant.port1.close();
    this.notify();
    await Promise.all(stops);
  }

  async endGrantsForTarget(targetId: number, reason: AudioSourceEndReason): Promise<void> {
    const ids = [...this.grants.values()].filter((g) => g.targetId === targetId).map((g) => g.info.grantId);
    await Promise.all(ids.map((id) => this.endGrant(id, reason)));
  }

  private openStream(
    grant: Grant,
    backend: AudioCaptureBackend,
    kind: 'system' | 'app',
    options: OpenOptions,
  ): boolean {
    const id = `${kind}-${grant.streams.size}`;
    const stream: OpenStream = { id, kind, handle: { stop: async () => {} }, queue: [] };
    const onChunk = (chunk: JsAudioChunk) => {
      if (chunk.frames === 0) return;
      stream.queue.push(chunk.data);
    };
    const onEvent = (ev: JsStreamEvent) => this.onStreamEvent(grant, stream, ev);
    // Registered before the backend call: a fatal event the addon fires
    // synchronously from inside openStream (permissionDenied/error at open
    // time) reaches onStreamEvent -> closeStream while the addon call is
    // still on the stack, and closeStream can only tear the stream down if
    // it can find it in grant.streams. Registering after the call returned
    // let such an event's teardown miss the entry, then this line inserted
    // it anyway — a zombie stream the grant would never notice again.
    grant.streams.set(id, stream);
    let handle: OpenStream['handle'];
    try {
      handle = backend.openStream(options, onChunk, onEvent);
    } catch (e) {
      grant.streams.delete(id);
      console.warn(`[audio-sources] could not open ${kind} stream: ${(e as Error).message}`);
      return false;
    }
    stream.handle = handle;
    if (!grant.streams.has(id)) {
      // The synchronous event above already closed this stream via the
      // placeholder handle (the only one closeStream could see at that
      // point); stop the real handle too so the addon's resource is
      // released, without waiting on it — the grant's own `opening` flag,
      // not this stream, is what keeps the grant alive for the rest of the
      // open loop.
      void handle.stop().catch(() => undefined);
      return false;
    }
    return true;
  }

  private onStreamEvent(grant: Grant, stream: OpenStream, ev: JsStreamEvent): void {
    const c: AudioSourceGrantCounters = grant.info.counters;
    switch (ev.type) {
      case 'chunkDropped':
        c.chunksDropped += ev.count ?? 1;
        return;
      case 'stalled':
        c.stalls += 1;
        return;
      case 'recovered':
        c.recoveries += 1;
        return;
      default: {
        const reason = reasonForEvent(ev.type, stream.kind);
        if (reason) void this.closeStream(grant, stream, reason);
      }
    }
  }

  private async closeStream(grant: Grant, stream: OpenStream, reason: AudioSourceEndReason): Promise<void> {
    if (!grant.streams.delete(stream.id)) return;
    await stream.handle.stop().catch(() => undefined);
    // While the grant is still being assembled (see `opening`), an empty
    // `streams` map is a transient state between rows, not "every stream is
    // gone" — ending the grant here would race the open loop's later rows.
    if (!grant.opening && grant.streams.size === 0) await this.endGrant(grant.info.grantId, reason);
  }

  /**
   * Emits the frames the wall clock says are due — never one frame per tick.
   *
   * The Tool's ring (`libs/api/src/pcm-ring.ts`, 200 ms at 48 kHz) is drained
   * by an AudioWorklet at exactly 48 000 samples/s, so this side must put
   * exactly 50 frames of `FRAME_SAMPLES` on the wire per wall-clock second.
   * The previous rule — always one frame per tick, plus a catch-up frame
   * whenever a queue was still non-empty — ratcheted above that rate: a tick
   * that found every queue empty still emitted silence, so the catch-up frames
   * were never paid back. Measured 2026-09-22 against a live grant: ~52
   * frames/s sent with `backlogDropped` 0, and the Tool's ring discarding 4-6 %
   * of samples with `underrunSamples` 0. Gating on elapsed time removes the
   * ratchet: a late chunk is delayed by one tick rather than replaced by a
   * silence frame, a tick that is not yet due emits nothing, and catch-up stays
   * bounded by `PUMP_MAX_FRAMES_PER_TICK` per tick.
   */
  private pump(grant: Grant): void {
    const rawDue = Math.floor((this.b.now() - grant.pumpStartedAt) / FRAME_MS) - grant.framesEmitted;
    // A stall leaves the ledger owing one frame per 20 ms it lasted. Replaying
    // all of it two frames per tick would run the wire at twice real time for
    // half the stall's length, so only `MAX_CATCHUP_FRAMES` are ever owed:
    // the rest is written off into `framesEmitted` (stale silence, skipped, not
    // replayed) and the ledger comes back in step with the wall clock.
    if (rawDue > MAX_CATCHUP_FRAMES) grant.framesEmitted += rawDue - MAX_CATCHUP_FRAMES;
    const due = Math.min(rawDue, MAX_CATCHUP_FRAMES);
    const count = Math.min(due, PUMP_MAX_FRAMES_PER_TICK);
    if (count <= 0) return;
    const queues = [...grant.streams.values()].map((s) => s.queue);
    for (let n = 0; n < count; n++) {
      const { inputs, dropped } = takeFrameInputs(queues);
      grant.info.counters.backlogDropped += dropped;
      try {
        grant.port1.postMessage(mixToInt16(inputs));
        grant.framesEmitted += 1;
        grant.info.counters.framesSent += 1;
      } catch {
        void this.endGrant(grant.info.grantId, 'tool-closed');
        return;
      }
    }
  }

  private notify(): void {
    this.b.onGrantsChanged(this.list());
  }
}

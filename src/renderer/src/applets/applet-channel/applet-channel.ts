import type {
  AppletId,
  AppletToParentMessage,
  AppletToParentRequest,
  IframeKind,
  ParentToAppletMessage,
} from '@theweave/api';
import { TransferableReply } from '../../transferable-reply.js';
import { getIframeKind } from './frame-identity.js';
import { hostTimeoutMessage } from './host-timeout.js';
import { replyWithError } from './reply-envelope.js';
import { assertValidRequest } from './request-validation.js';

/** Every request type except `ready`, which the channel answers itself. */
export type HandledRequest = Exclude<AppletToParentRequest, { type: 'ready' }>;

/** Who sent a request: the identity derived from its origin, and its window. */
export type RequestContext = { kind: IframeKind; source: MessageEventSource };

/**
 * Answers one request from a frame. A window supplies its own handler, so the
 * main window and a WAL window share every wire concern and differ only in
 * where each request type is handled.
 */
export type RequestHandler = (request: HandledRequest, context: RequestContext) => Promise<unknown>;

type RegistryEntry = { subType: string; source: MessageEventSource | null | 'wal-window' };

/**
 * The frames a window knows about: applet views by applet, and cross-group
 * views by tool. An entry whose source is `'wal-window'` lives in another
 * window and is reached over IPC, not by this channel.
 */
export type FrameRegistry = {
  appletIframes: Record<AppletId, RegistryEntry[]>;
  crossGroupIframes: Record<string, RegistryEntry[]>;
};

/** A frame this window hosts, with how messages about it name it. */
type HostedFrame = { source: MessageEventSource; target: string };

export type AppletChannelOptions = {
  registry: FrameRegistry;
  /** Undefined while the window has not yet learned it; messages are ignored until then. */
  isAppletDev: () => boolean | undefined;
  /** This window itself, whose own messages (e.g. relayed ports) are not requests. */
  ownWindow?: unknown;
  requestTimeoutMs?: number;
  /** How many broadcasts to hold per frame that is not ready yet. */
  queueCap?: number;
};

type FrameState = { ready: boolean; held: ParentToAppletMessage[] };

type ReadyWaiter = {
  appletId: AppletId;
  subType: string;
  resolve: (source: MessageEventSource | undefined) => void;
  timer: ReturnType<typeof setTimeout>;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
const DEFAULT_QUEUE_CAP = 100;

/** How long a window waits for its frames to finish their unload callbacks. */
export const UNLOAD_TIMEOUT_MS = 8000;

/**
 * The message link between one window of Moss and the applet frames it hosts.
 * It derives each sender's identity from its origin, checks each request
 * against the protocol schema, wraps every answer in the success/error reply
 * envelope, tracks which frames are ready to receive messages, holds
 * broadcasts for frames that are not ready yet, and times out requests that a
 * frame never answers.
 */
export class AppletChannel {
  private readonly frames = new WeakMap<MessageEventSource, FrameState>();
  private readyWaiters: ReadyWaiter[] = [];
  private readonly requestTimeoutMs: number;
  private readonly queueCap: number;

  constructor(private readonly options: AppletChannelOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.queueCap = options.queueCap ?? DEFAULT_QUEUE_CAP;
  }

  /** Handles every request that reaches `target` with `handle`. Returns a function that stops. */
  listen(target: Window, handle: RequestHandler): () => void {
    const listener = (event: MessageEvent<AppletToParentMessage>) => {
      void this.receive(event, handle);
    };
    target.addEventListener('message', listener);
    return () => target.removeEventListener('message', listener);
  }

  async receive(event: MessageEvent<AppletToParentMessage>, handle: RequestHandler): Promise<void> {
    if (this.options.ownWindow !== undefined && event.source === this.options.ownWindow) return;
    const isAppletDev = this.options.isAppletDev();
    if (isAppletDev === undefined) return;
    const source = event.source;
    try {
      const kind = getIframeKind(event.origin, event.data?.source, isAppletDev);
      if (!kind) return;
      if (!source) throw new Error('Request arrived without a source window');
      const request: unknown = event.data?.request;
      assertValidRequest(request);

      if (request.type === 'ready') {
        this.markReady(source);
        event.ports[0]?.postMessage({ type: 'success', result: undefined });
        return;
      }
      if (request.type === 'unregister-iframe') this.forget(source);

      const result = await handle(request, { kind, source });
      if (result instanceof TransferableReply) {
        event.ports[0]?.postMessage({ type: 'success', result: result.result }, result.transfer);
      } else {
        event.ports[0]?.postMessage({ type: 'success', result });
      }
    } catch (e) {
      console.error('Error while handling applet iframe message.', e, 'Origin:', event.origin);
      replyWithError(event.ports, e);
    }
  }

  isReady(source: MessageEventSource): boolean {
    return this.frames.get(source)?.ready ?? false;
  }

  /** Records that a frame can answer messages, and sends it what was held for it. */
  markReady(source: MessageEventSource): void {
    const state = this.stateOf(source);
    state.ready = true;
    const held = state.held;
    state.held = [];
    held.forEach((message) => post(source, message));
    this.readyWaiters = this.readyWaiters.filter((waiter) => {
      const frame = this.readyFrame(waiter.appletId, waiter.subType);
      if (!frame) return true;
      clearTimeout(waiter.timer);
      waiter.resolve(frame);
      return false;
    });
  }

  /**
   * Resolves with the window of the applet's view of the given subtype once it
   * is ready, or with undefined if that does not happen within timeoutMs.
   */
  waitForReadyAppletFrame(
    appletId: AppletId,
    subType: string,
    timeoutMs: number,
  ): Promise<MessageEventSource | undefined> {
    const frame = this.readyFrame(appletId, subType);
    if (frame) return Promise.resolve(frame);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((w) => w !== waiter);
        resolve(undefined);
      }, timeoutMs);
      const waiter: ReadyWaiter = { appletId, subType, resolve, timer };
      this.readyWaiters.push(waiter);
    });
  }

  /**
   * Sends a message to every frame of the given applets that this window hosts,
   * or to every applet and cross-group view for `'all'`. A frame that is not
   * ready gets the message when it becomes ready.
   */
  broadcast(appletIds: 'all' | AppletId[], message: ParentToAppletMessage): void {
    for (const { source } of this.hostedFrames(appletIds)) {
      if (this.isReady(source)) {
        post(source, message);
      } else {
        this.hold(source, message);
      }
    }
  }

  /**
   * Sends a request to one frame and resolves with its answer. `target` names
   * the frame in errors, e.g. "applet <id>".
   */
  request<T>(
    source: MessageEventSource,
    message: ParentToAppletMessage,
    options: { target: string; timeoutMs?: number },
  ): Promise<T> {
    if (isClosed(source)) {
      this.forget(source);
      return Promise.reject(
        new Error(`postMessage '${message.type}' to ${options.target}: its window was closed.`),
      );
    }
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
    const timeoutText = hostTimeoutMessage(
      message.type,
      options.target,
      timeoutMs,
      this.isReady(source) ? 'reported' : 'assumed',
    );
    return new Promise<T>((resolve, reject) => {
      const { port1, port2 } = new MessageChannel();
      const timeout = setTimeout(() => {
        port1.close();
        reject(new Error(timeoutText));
      }, timeoutMs);
      port1.onmessage = (m) => {
        clearTimeout(timeout);
        port1.close();
        if (m.data?.type === 'success') resolve(m.data.result);
        else reject(new Error(String(m.data?.error)));
      };
      post(source, message, [port2]);
    });
  }

  /**
   * Sends a request to every ready frame of the given applets and resolves once
   * all of them answered or timed out. Frames that are not ready are skipped.
   */
  async requestAll(
    appletIds: 'all' | AppletId[],
    message: ParentToAppletMessage,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<void> {
    const ready = this.hostedFrames(appletIds).filter(({ source }) => this.isReady(source));
    const results = await Promise.allSettled(
      ready.map(({ source, target }) => this.request(source, message, { target, timeoutMs })),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn(
          String(result.reason instanceof Error ? result.reason.message : result.reason),
        );
      }
    }
  }

  private forget(source: MessageEventSource): void {
    this.frames.delete(source);
  }

  private stateOf(source: MessageEventSource): FrameState {
    let state = this.frames.get(source);
    if (!state) {
      state = { ready: false, held: [] };
      this.frames.set(source, state);
    }
    return state;
  }

  private hold(source: MessageEventSource, message: ParentToAppletMessage): void {
    const state = this.stateOf(source);
    state.held.push(message);
    if (state.held.length > this.queueCap) {
      const dropped = state.held.shift();
      console.warn(
        `Dropped a held '${dropped?.type}' message for a frame that has not reported ready.`,
      );
    }
  }

  private readyFrame(appletId: AppletId, subType: string): MessageEventSource | undefined {
    for (const info of this.options.registry.appletIframes[appletId] ?? []) {
      if (info.subType !== subType || !isHostedSource(info.source)) continue;
      if (isClosed(info.source)) {
        this.forget(info.source);
        continue;
      }
      if (this.isReady(info.source)) return info.source;
    }
    return undefined;
  }

  /**
   * The frames of the given applets that this window hosts and that still
   * exist; for `'all'`, cross-group views too. A frame removed from the page
   * without unregistering keeps its registry entry, but its window reports
   * closed; the channel forgets it.
   */
  private hostedFrames(appletIds: 'all' | AppletId[]): HostedFrame[] {
    const { appletIframes, crossGroupIframes } = this.options.registry;
    const groups: Array<{ entries: RegistryEntry[]; target: string }> = (
      appletIds === 'all' ? Object.keys(appletIframes) : appletIds
    ).map((id) => ({ entries: appletIframes[id] ?? [], target: `applet ${id}` }));
    if (appletIds === 'all') {
      for (const [toolId, entries] of Object.entries(crossGroupIframes)) {
        groups.push({ entries, target: `cross-group view of tool ${toolId}` });
      }
    }
    const frames: HostedFrame[] = [];
    for (const { entries, target } of groups) {
      for (const { source } of entries) {
        if (!isHostedSource(source)) continue;
        if (isClosed(source)) {
          this.forget(source);
          continue;
        }
        frames.push({ source, target });
      }
    }
    return frames;
  }
}

function isHostedSource(
  source: MessageEventSource | null | 'wal-window',
): source is MessageEventSource {
  return !!source && source !== 'wal-window';
}

function post(
  source: MessageEventSource,
  message: ParentToAppletMessage,
  transfer?: Transferable[],
) {
  (source as Window).postMessage(message, { targetOrigin: '*', transfer });
}

/** Whether a frame's window is gone. `closed` is readable across origins. */
function isClosed(source: MessageEventSource): boolean {
  try {
    return (source as Window).closed === true;
  } catch {
    return false;
  }
}

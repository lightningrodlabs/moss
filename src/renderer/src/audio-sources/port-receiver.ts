import type { AudioSourcePortDelivery } from '@theweave/moss-types';

/** The page-level message the preload posts when main delivers a grant port. */
export function matchAudioSourcePortMessage(data: unknown): AudioSourcePortDelivery | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { type?: unknown; requestId?: unknown; grantId?: unknown };
  if (d.type !== 'audio-source-port') return null;
  if (typeof d.requestId !== 'string' || typeof d.grantId !== 'string') return null;
  return { requestId: d.requestId, grantId: d.grantId };
}

type Pending = { resolve: (port: MessagePort) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export const PORT_DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Correlates grant ports posted into the page by the preload relay with the
 * request that asked for them. Only messages whose `source` is this window are
 * honoured: the relay runs in this window, while an iframe could post the same
 * shape and must not be able to substitute a port.
 *
 * A page can navigate while its request is still pending in the picker; main
 * then delivers a port for a requestId no longer being waited on. `onOrphan`
 * is called with that delivery's grantId so the caller can end the grant in
 * main instead of leaving it running with nobody listening.
 */
export class AudioSourcePortReceiver {
  private pending = new Map<string, Pending>();

  constructor(
    private readonly self: Window,
    private readonly onOrphan: (grantId: string) => void,
  ) {}

  install(target: { addEventListener(type: 'message', listener: (e: MessageEvent) => void): void }): void {
    target.addEventListener('message', (e) => this.handleMessage(e));
  }

  expect(requestId: string, timeoutMs: number = PORT_DELIVERY_TIMEOUT_MS): Promise<MessagePort> {
    return new Promise<MessagePort>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`audio-source port delivery for ${requestId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });
  }

  handleMessage(event: MessageEvent): void {
    if (event.source !== this.self) return;
    const delivery = matchAudioSourcePortMessage(event.data);
    if (!delivery) return;
    const port = event.ports?.[0];
    const waiter = this.pending.get(delivery.requestId);
    if (!waiter) {
      port?.close();
      this.onOrphan(delivery.grantId);
      return;
    }
    this.pending.delete(delivery.requestId);
    clearTimeout(waiter.timer);
    if (!port) {
      waiter.reject(new Error(`audio-source port delivery for ${delivery.requestId} arrived without a port`));
      return;
    }
    waiter.resolve(port);
  }
}

import type { AudioSourcePortDelivery } from '@theweave/moss-types';

/** The page-level message the preload posts when main delivers a grant port. */
export function matchAudioSourcePortMessage(data: unknown): AudioSourcePortDelivery | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { type?: unknown; requestId?: unknown; grantId?: unknown };
  if (d.type !== 'audio-source-port') return null;
  if (typeof d.requestId !== 'string' || typeof d.grantId !== 'string') return null;
  return { requestId: d.requestId, grantId: d.grantId };
}

type Pending = {
  resolve: (port: MessagePort) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
};

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

  // No deadline is armed here: the caller's own invoke (opening the picker,
  // waiting on the user) has to resolve before there is anything to bound,
  // and that wait is a human decision, not an IPC delivery. Call
  // `armDeadline` once the invoke has actually answered.
  expect(requestId: string): Promise<MessagePort> {
    // A still-pending call for the same requestId is superseded rather than
    // silently overwritten: without this, its timer (if any) would still be
    // armed, and when it fired it would delete the map entry that by then
    // belongs to the new call, orphaning a delivery that has a live waiter.
    const superseded = this.pending.get(requestId);
    if (superseded) {
      if (superseded.timer) clearTimeout(superseded.timer);
      this.pending.delete(requestId);
      superseded.reject(new Error(`audio-source port expectation for ${requestId} superseded`));
    }
    return new Promise<MessagePort>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, timer: undefined });
    });
  }

  /**
   * Arms (or restarts) the delivery deadline for a still-pending waiter,
   * bounding the sub-second relay of the port itself rather than the wait
   * that preceded it. A no-op if `requestId` is not pending (already
   * delivered, superseded, or cancelled).
   */
  armDeadline(requestId: string, timeoutMs: number = PORT_DELIVERY_TIMEOUT_MS): void {
    const waiter = this.pending.get(requestId);
    if (!waiter) return;
    if (waiter.timer) clearTimeout(waiter.timer);
    const timer = setTimeout(() => {
      // Only clear the entry if it is still the one this timer belongs to
      // — a later `armDeadline`/`expect` call for the same requestId already
      // cleared and replaced it.
      const current = this.pending.get(requestId);
      if (current?.timer !== timer) return;
      this.pending.delete(requestId);
      current.reject(new Error(`audio-source port delivery for ${requestId} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    waiter.timer = timer;
  }

  /**
   * Cancels a still-pending waiter (the invoke answered `null`, or threw):
   * clears any armed timer and rejects, so a delivery that races in for
   * this id anyway lands on `onOrphan` instead of resolving a call the
   * caller has already given up on.
   */
  cancel(requestId: string): void {
    const waiter = this.pending.get(requestId);
    if (!waiter) return;
    if (waiter.timer) clearTimeout(waiter.timer);
    this.pending.delete(requestId);
    waiter.reject(new Error(`audio-source port expectation for ${requestId} cancelled`));
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
    if (waiter.timer) clearTimeout(waiter.timer);
    if (!port) {
      waiter.reject(new Error(`audio-source port delivery for ${delivery.requestId} arrived without a port`));
      return;
    }
    waiter.resolve(port);
  }
}

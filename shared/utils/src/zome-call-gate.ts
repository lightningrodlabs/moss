import {
  AppWebsocket,
  CallZomeRequest,
  RoleNameCallZomeRequest,
  encodeHashToBase64,
} from '@holochain/client';

const INIT_TIMEOUT_TEXT = 'triggered the `init()` callback';

/**
 * Client-side timeout for the call that warms a cell. That call runs the cell's `init()`, which
 * can take longer than the client's default 60 s on a cold, newly joined cell.
 */
export const WARMING_CALL_TIMEOUT_MS = 180_000;

/** True when the conductor gave up waiting for another call's `init()` to finish. */
export function isInitTimeoutError(error: unknown): boolean {
  return String(error).includes(INIT_TIMEOUT_TEXT);
}

/** Identifies the cell a zome call targets, so calls can be gated per cell. */
export function cellKeyOf(request: CallZomeRequest | RoleNameCallZomeRequest): string {
  if ('role_name' in request && request.role_name) return request.role_name;
  const [dnaHash, agentPubKey] = (request as CallZomeRequest).cell_id;
  return `${encodeHashToBase64(dnaHash)}:${encodeHashToBase64(agentPubKey)}`;
}

type KeyState = { kind: 'warming'; inFlight: Promise<unknown> } | { kind: 'warm' };

/**
 * Lets the first call on each cell run alone, so the conductor's `init()` for
 * that cell is triggered by one call instead of racing several. Once a call
 * has succeeded the cell is warm and calls run concurrently.
 */
export class CellCallGate {
  private states = new Map<string, KeyState>();

  /** Runs `fn` for `cellKey`; `fn` learns whether it is the call that warms the cell. */
  async run<T>(cellKey: string, fn: (isWarmer: boolean) => Promise<T>): Promise<T> {
    for (;;) {
      const state = this.states.get(cellKey);
      if (state?.kind === 'warm') return fn(false);
      if (state?.kind === 'warming') {
        await state.inFlight.catch(() => undefined);
        continue;
      }
      const inFlight = fn(true);
      this.states.set(cellKey, { kind: 'warming', inFlight });
      try {
        const result = await inFlight;
        this.states.set(cellKey, { kind: 'warm' });
        return result;
      } catch (e) {
        this.states.delete(cellKey);
        throw e;
      }
    }
  }
}

export interface InitRetryOptions {
  spacingMs: number;
  deadlineMs: number;
  /** When the call was first requested (ms since epoch); the deadline is measured from here. */
  startedAt?: number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retries `fn` while it fails with the conductor's init timeout, until the
 * deadline (measured from `startedAt`, default now) would be passed by the next attempt.
 */
export async function retryInitTimeout<T>(
  fn: () => Promise<T>,
  opts: Partial<InitRetryOptions> = {},
): Promise<T> {
  const spacingMs = opts.spacingMs ?? 2000;
  const deadlineMs = opts.deadlineMs ?? 120000;
  const sleep = opts.sleep ?? realSleep;
  const start = opts.startedAt ?? Date.now();
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (!isInitTimeoutError(e)) throw e;
      if (Date.now() + spacingMs - start > deadlineMs) throw e;
      await sleep(spacingMs);
    }
  }
}

const gates = new WeakMap<AppWebsocket, CellCallGate>();

/**
 * Replaces `appWs.callZome` with a version that runs the first call per cell
 * alone and retries init timeouts. Wraps the instance method so wrappers
 * applied earlier or later on the same instance compose.
 */
export function instrumentZomeCallGate(
  appWs: AppWebsocket,
  gate: CellCallGate,
  retry?: Partial<InitRetryOptions>,
): void {
  gates.set(appWs, gate);
  const original = appWs.callZome.bind(appWs);
  appWs.callZome = ((request: CallZomeRequest | RoleNameCallZomeRequest, timeout?: number) => {
    const startedAt = Date.now();
    return gate.run(cellKeyOf(request), (isWarmer) => {
      const callTimeout = isWarmer ? (timeout ?? WARMING_CALL_TIMEOUT_MS) : timeout;
      return retryInitTimeout(() => original(request, callTimeout), { ...retry, startedAt });
    });
  }) as AppWebsocket['callZome'];
}

/** The gate attached to `appWs`; attaches a new one if there is none yet. */
export function zomeCallGateOf(appWs: AppWebsocket): CellCallGate {
  let gate = gates.get(appWs);
  if (!gate) {
    gate = new CellCallGate();
    instrumentZomeCallGate(appWs, gate);
  }
  return gate;
}

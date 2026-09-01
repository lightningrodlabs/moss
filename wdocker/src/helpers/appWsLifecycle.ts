import type { AppWebsocket, IssueAppAuthenticationTokenRequest, WsClient } from '@holochain/client';

/**
 * The token parameters an app websocket is authenticated with.
 */
export type AppAuthTokenParams = Required<
  Pick<IssueAppAuthenticationTokenRequest, 'expiry_seconds' | 'single_use'>
>;

/**
 * Token parameters for sockets that live for the uptime of the node.
 *
 * The sticky-token patch re-authenticates with the retained token on every
 * reconnect, so the token has to stay redeemable indefinitely for the socket
 * to survive a transient drop.
 */
export const LONG_LIVED_APP_AUTH_TOKEN_PARAMS: AppAuthTokenParams = {
  single_use: false,
  expiry_seconds: 0,
};

/**
 * Token parameters for sockets that are opened and closed within a single
 * check cycle.
 *
 * Such a socket is redeemed once, immediately, so a short-lived single-use
 * token keeps redeemable tokens from piling up in the conductor.
 */
export const PER_CYCLE_APP_AUTH_TOKEN_PARAMS: AppAuthTokenParams = {
  single_use: true,
  expiry_seconds: 10,
};

/**
 * How long to wait for a websocket to report that it closed before giving up
 * on it.
 */
export const DEFAULT_CLOSE_TIMEOUT_MS = 5000;

/**
 * Run `use` against a freshly connected app websocket and close it afterwards.
 *
 * The daemon reconnects on every check cycle for the lifetime of an
 * always-online node, so each connection has to be handed back; only the
 * peer-status sockets are meant to outlive a cycle.
 *
 * A failure to close is logged rather than thrown: the callback's result (or
 * its own error) is what the caller cares about.
 */
export async function withAppWs<T>(
  connect: () => Promise<AppWebsocket>,
  use: (appWs: AppWebsocket) => Promise<T>,
  closeTimeoutMs: number = DEFAULT_CLOSE_TIMEOUT_MS,
): Promise<T> {
  const appWs = await connect();
  try {
    return await use(appWs);
  } finally {
    await closeAppWs(appWs, closeTimeoutMs);
  }
}

/**
 * Close an app websocket, bounded in time.
 *
 * `WsClient.close()` resolves on the socket's `close` event, which a socket
 * that is already gone will never emit. Bounding the wait keeps every cycle's
 * promise settling so the daemon does not accumulate stranded work.
 */
async function closeAppWs(appWs: AppWebsocket, closeTimeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race<'closed' | 'timed out'>([
      (async (): Promise<'closed'> => {
        await (appWs.client as unknown as WsClient).close();
        return 'closed';
      })(),
      new Promise<'timed out'>((resolve) => {
        timer = setTimeout(() => resolve('timed out'), closeTimeoutMs);
      }),
    ]);
    if (outcome === 'timed out') {
      console.warn(
        `App websocket did not report closing within ${closeTimeoutMs}ms. Abandoning it.`,
      );
    }
  } catch (e) {
    console.warn('Failed to close app websocket: ', e);
  } finally {
    clearTimeout(timer);
  }
}

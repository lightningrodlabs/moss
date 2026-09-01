import type { AppWebsocket, WsClient } from '@holochain/client';

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
): Promise<T> {
  const appWs = await connect();
  try {
    return await use(appWs);
  } finally {
    try {
      await (appWs.client as unknown as WsClient).close();
    } catch (e) {
      console.warn('Failed to close app websocket: ', e);
    }
  }
}

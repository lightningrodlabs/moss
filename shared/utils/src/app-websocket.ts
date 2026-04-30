import {
  AppWebsocket,
  AppWebsocketConnectionOptions,
  CallZomeRequest,
  RoleNameCallZomeRequest,
} from '@holochain/client';

export interface ZomeCallTiming {
  fnName: string;
  durationMs: number;
}

export type ZomeCallLogger = (timing: ZomeCallTiming) => void;

/**
 * Construct an AppWebsocket the moss way: standard `AppWebsocket.connect`
 * followed by a sticky-token patch on the underlying `WsClient`.
 *
 * Use this from every site in moss that needs an `AppWebsocket` (renderer
 * cache, applet iframes). Anything that goes via `AppWebsocket.connect`
 * directly will skip the recovery patch and re-introduce the wedge.
 */
export async function createAppWebsocket(
  opts: AppWebsocketConnectionOptions,
): Promise<AppWebsocket> {
  const appWs = await AppWebsocket.connect(opts);
  applyStickyAuthToken(appWs);
  return appWs;
}

/**
 * Workaround for a wedge in `@holochain/client` (v0.20.4-rc.0 / `main-0.6`,
 * also present on `main`): `WsClient.reconnectWebsocket` nulls its private
 * `authenticationToken` field on any non-success outcome of a reconnect
 * attempt — transient network blip, brief conductor unavailability, race
 * with a server-initiated close. Once nulled, `exchange()` rejects every
 * subsequent request with `WebsocketClosedError` forever; no recovery path
 * exists.
 *
 * Refusing `undefined` writes keeps the field populated, so the built-in
 * auto-reconnect in `exchange()` keeps trying through transient failures
 * and the same `AppWebsocket` instance stays usable for long-lived
 * consumers (e.g. `GroupStore` and its child clients, which capture the
 * websocket reference at construction).
 *
 * Filed upstream in the holochain-client-js repo
 * (`WEBSOCKET_WEDGE_BUG.md`). Remove this once the upstream fix lands and
 * we upgrade.
 */
export function applyStickyAuthToken(appWs: AppWebsocket): void {
  const wsClient = (appWs as unknown as { client: object }).client;
  const TOKEN_KEY = 'authenticationToken';
  let token = (wsClient as Record<string, unknown>)[TOKEN_KEY];
  Object.defineProperty(wsClient, TOKEN_KEY, {
    get() {
      return token;
    },
    set(v: unknown) {
      if (v !== undefined) token = v;
    },
    configurable: true,
  });
}

/**
 * Replace `appWs.callZome` with a wrapper that times each call and reports
 * the result via `logger`. The logger runs in a microtask so it never
 * blocks the response.
 *
 * Centralizes the previously-duplicated logging wrappers in moss-store
 * and the applet iframe.
 */
export function instrumentZomeCallLogging(
  appWs: AppWebsocket,
  logger: ZomeCallLogger,
): void {
  const callZomePure = AppWebsocket.prototype.callZome;
  appWs.callZome = async <ReturnType>(
    request: CallZomeRequest | RoleNameCallZomeRequest,
    timeout?: number,
  ): Promise<ReturnType> => {
    const start = Date.now();
    const response = await callZomePure.apply(appWs, [request, timeout]);
    const end = Date.now();
    setTimeout(() =>
      logger({
        fnName: request.fn_name,
        durationMs: end - start,
      }),
    );
    return response as ReturnType;
  };
}

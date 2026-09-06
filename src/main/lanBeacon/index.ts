import { createBeaconPipe, type BeaconDiagnostics, type BeaconPipe } from './pipe.js';
import { openBeaconSocket, type BeaconSocket } from './socket.js';

export type { BeaconDiagnostics } from './pipe.js';

export type LanBeaconService = {
  /** The payload to repeat while anything is listening; cleared when the socket closes. */
  setHello(payload: Uint8Array | undefined): void;
  setListening(listening: boolean, onDatagram: DatagramForwarder): Promise<void>;
  /**
   * Returns the id of the advertisement now on the wire, or undefined if
   * nobody is listening and there is therefore no pipe to advertise through.
   */
  startAdvertising(payload: Uint8Array, durationMs: number): number | undefined;
  /** With an id, stops only that advertisement; without one, stops whatever is running. */
  stopAdvertising(id?: number): void;
  unicast(payload: Uint8Array, address: string, port: number): void;
  diagnostics(): BeaconDiagnostics;
  shutdown(): Promise<void>;
};

export type DatagramForwarder = (payload: Uint8Array, address: string, port: number) => void;

const IDLE: BeaconDiagnostics = {
  bound: false,
  interfaces: [],
  advertising: false,
  advertisementId: undefined,
  sent: 0,
  received: 0,
  dropped: 0,
};

export type LanBeaconServiceDeps = {
  /** Injectable for tests; production callers get the real UDP socket. */
  openSocket?: typeof openBeaconSocket;
};

/**
 * The socket is opened only once something asks to listen. Binding at launch
 * would raise the macOS local-network prompt and the Windows firewall dialog on
 * every cold start, for a feature most sessions never touch.
 *
 * Several independent owners (the join dialog, the invite dialog, the
 * debugging panel) each hold their own `setListening` on/off lifecycle, but
 * they all share this one process-wide socket. A plain boolean would let any
 * one owner's close silence the others, so listening is refcounted: the
 * socket opens on the transition from zero owners to one, and closes only on
 * the transition back to zero.
 */
export function createLanBeaconService(deps: LanBeaconServiceDeps = {}): LanBeaconService {
  const openSocket = deps.openSocket ?? openBeaconSocket;
  let socket: BeaconSocket | undefined;
  let pipe: BeaconPipe | undefined;
  // Guards the async gap between deciding to open and the socket actually
  // binding: two callers racing setListening(true) before either finishes
  // must share one open rather than each starting their own and leaking one.
  let opening: Promise<void> | undefined;
  // How many owners currently want the socket open. Floored at zero so a
  // stray extra release (an owner calling setListening(false) more times
  // than it called setListening(true)) can never leave the count negative —
  // a negative count would otherwise take an extra genuine open to work off
  // before a later owner's claim actually bound a socket.
  let listenerCount = 0;

  async function close(): Promise<void> {
    // An open still in flight has not published its socket/pipe into the
    // closure yet; wait for it so close() has something to actually close,
    // instead of no-op'ing here and orphaning the socket once it resolves.
    if (opening) {
      await opening.catch(() => undefined);
    }
    pipe?.stop();
    pipe = undefined;
    await socket?.close();
    socket = undefined;
  }

  return {
    async setListening(listening, onDatagram) {
      if (!listening) {
        listenerCount = Math.max(0, listenerCount - 1);
        if (listenerCount > 0) return;
        await close();
        return;
      }
      listenerCount++;
      // The pipe (and the onDatagram forwarder it was built with) is created
      // once, on the transition into the first owner, and lives for as long
      // as any owner holds the count above zero. Every owner's datagrams
      // arrive over this one shared socket, so a later setListening(true)
      // must not wire a second forwarder — that would deliver each incoming
      // datagram once per owner instead of once, total.
      if (pipe) return;
      if (opening) {
        await opening;
        return;
      }
      opening = (async () => {
        const openedSocket = await openSocket((payload, address, port) =>
          pipe?.deliver(payload, address, port),
        );
        socket = openedSocket;
        pipe = createBeaconPipe({
          socket: openedSocket,
          now: () => Date.now(),
          setInterval: (fn, ms) => setInterval(fn, ms),
          clearInterval: (handle) => clearInterval(handle),
          onDatagram,
        });
      })();
      try {
        await opening;
      } finally {
        opening = undefined;
      }
    },
    setHello: (payload) => pipe?.setHello(payload),
    startAdvertising: (payload, durationMs) => pipe?.startAdvertising(payload, durationMs),
    stopAdvertising: (id) => pipe?.stopAdvertising(id),
    unicast: (payload, address, port) => pipe?.unicast(payload, address, port),
    diagnostics: () => pipe?.diagnostics() ?? IDLE,
    async shutdown() {
      // The app-quit path tears everything down regardless of who still
      // thinks they're listening — there is no "later owner" to protect once
      // the process itself is going away.
      listenerCount = 0;
      await close();
    },
  };
}

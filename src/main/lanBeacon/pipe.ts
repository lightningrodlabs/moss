import { MAX_DATAGRAM_BYTES } from './limits.js';
import type { BeaconSocket } from './socket.js';

/** Frequent enough that someone watching a list sees an arrival as it happens. */
export const BEACON_INTERVAL_MS = 3000;

const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_PER_WINDOW = 60;

export type BeaconDiagnostics = {
  bound: boolean;
  interfaces: string[];
  advertising: boolean;
  /** Beacons this computer has put on the wire since the socket opened. */
  sent: number;
  /**
   * Identifies the advertisement currently on the wire. There is one
   * advertisement slot for the whole process, so an owner that started one
   * compares this against the id it was handed to tell "mine is still
   * broadcasting" from "somebody else's replaced it".
   */
  advertisementId: number | undefined;
  received: number;
  dropped: number;
};

export type BeaconPipe = {
  /**
   * The payload to repeat for as long as anything is listening, or undefined
   * to stop. Separate from the advertisement slot because it belongs to the
   * process rather than to whichever pane is open: its purpose is to keep this
   * machine's radio awake and to draw unicast answers, so it must survive one
   * pane closing while another still listens.
   */
  setHello(payload: Uint8Array | undefined): void;
  /** Returns the id of the advertisement now on the wire, for the caller to stop later. */
  startAdvertising(payload: Uint8Array, durationMs: number): number;
  /** With an id, stops only that advertisement; without one, stops whatever is running. */
  stopAdvertising(id?: number): void;
  unicast(payload: Uint8Array, address: string, port: number): void;
  deliver(payload: Uint8Array, address: string, port: number): void;
  diagnostics(): BeaconDiagnostics;
  stop(): void;
};

export type BeaconPipeDeps = {
  socket: BeaconSocket;
  now: () => number;
  setInterval: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearInterval: (handle: NodeJS.Timeout) => void;
  onDatagram: (payload: Uint8Array, address: string, port: number) => void;
};

export function createBeaconPipe(deps: BeaconPipeDeps): BeaconPipe {
  let advertisement: { id: number; payload: Uint8Array; deadline: number } | undefined;
  let handle: NodeJS.Timeout | undefined;
  let nextAdvertisementId = 1;
  let received = 0;
  let dropped = 0;
  let sent = 0;
  let hello: Uint8Array | undefined;
  let helloHandle: NodeJS.Timeout | undefined;
  let windowStart = deps.now();
  let inWindow = 0;

  function clearAdvertisement(): void {
    advertisement = undefined;
    if (handle !== undefined) {
      deps.clearInterval(handle);
      handle = undefined;
    }
  }

  function tick(): void {
    if (!advertisement) return;
    if (deps.now() >= advertisement.deadline) {
      clearAdvertisement();
      return;
    }
    sent++;
    deps.socket.broadcast(advertisement.payload);
  }

  function sendHello(): void {
    if (!hello) return;
    sent++;
    deps.socket.broadcast(hello);
  }

  return {
    setHello(payload) {
      hello = payload;
      if (helloHandle !== undefined) {
        deps.clearInterval(helloHandle);
        helloHandle = undefined;
      }
      if (!payload) return;
      // At once, then on the same cadence as a beacon: a pane that has just
      // opened should draw answers now rather than in three seconds.
      sendHello();
      helloHandle = deps.setInterval(sendHello, BEACON_INTERVAL_MS);
    },

    startAdvertising(payload, durationMs) {
      clearAdvertisement();
      const id = nextAdvertisementId++;
      advertisement = { id, payload, deadline: deps.now() + durationMs };
      // Send at once: waiting a full interval makes the button feel broken.
      sent++;
      deps.socket.broadcast(payload);
      handle = deps.setInterval(tick, BEACON_INTERVAL_MS);
      return id;
    },
    stopAdvertising(id) {
      // An owner whose advertisement was already replaced (or has already run
      // out) must not silence whoever holds the slot now.
      if (id !== undefined && advertisement?.id !== id) return;
      clearAdvertisement();
    },
    unicast(payload, address, port) {
      deps.socket.unicast(payload, address, port);
    },
    deliver(payload, address, port) {
      if (payload.length > MAX_DATAGRAM_BYTES) {
        dropped++;
        return;
      }
      const now = deps.now();
      if (now - windowStart >= RATE_LIMIT_WINDOW_MS) {
        windowStart = now;
        inWindow = 0;
      }
      if (inWindow >= RATE_LIMIT_PER_WINDOW) {
        dropped++;
        return;
      }
      inWindow++;
      received++;
      deps.onDatagram(payload, address, port);
    },
    diagnostics: () => ({
      bound: true,
      interfaces: deps.socket.joinedInterfaces(),
      advertising: advertisement !== undefined,
      advertisementId: advertisement?.id,
      sent,
      received,
      dropped,
    }),
    stop() {
      clearAdvertisement();
    },
  };
}
